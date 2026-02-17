/**
 * PCM audio capture from microphone using AudioWorklet.
 *
 * Captures microphone audio, resamples to 16kHz 16-bit PCM mono,
 * and delivers base64-encoded chunks via callback.
 *
 * Safari compatibility:
 * - AudioWorklet.addModule() requires a URL (not blob:), so we fall back
 *   to a data URL if blob URL fails.
 * - Safari may ignore AudioContext sampleRate option, so we manually
 *   resample from native rate to 16kHz.
 */

const PROCESSOR_CODE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0]?.[0];
        if (input && input.length > 0) {
            this.port.postMessage(input);
        }
        return true;
    }
}
registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
`;

const TARGET_SAMPLE_RATE = 16000;

export interface AudioCaptureOptions {
    onData: (base64PCM: string) => void;
    onError?: (error: Error) => void;
}

export interface AudioCapture {
    start(): Promise<void>;
    stop(): void;
}

function resample(input: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array {
    if (sourceSampleRate === targetSampleRate) return input;
    const ratio = sourceSampleRate / targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
        const srcIndex = i * ratio;
        const low = Math.floor(srcIndex);
        const high = Math.min(low + 1, input.length - 1);
        const frac = srcIndex - low;
        output[i] = input[low] * (1 - frac) + input[high] * frac;
    }
    return output;
}

function float32ToBase64PCM16(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function createAudioCapture(options: AudioCaptureOptions): AudioCapture {
    let audioContext: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let workletNode: AudioWorkletNode | null = null;

    return {
        async start() {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new AudioContext();
            const nativeSampleRate = audioContext.sampleRate;

            // Register worklet processor (blob URL with Safari data URL fallback)
            const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            try {
                await audioContext.audioWorklet.addModule(url);
            } catch {
                const base64 = btoa(PROCESSOR_CODE);
                const dataUrl = `data:application/javascript;base64,${base64}`;
                await audioContext.audioWorklet.addModule(dataUrl);
            } finally {
                URL.revokeObjectURL(url);
            }

            sourceNode = audioContext.createMediaStreamSource(stream);
            workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor');

            let buffer = new Float32Array(0);
            const CHUNK_SIZE = Math.floor(nativeSampleRate * 0.1); // ~100ms chunks

            workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
                const samples = event.data;
                const newBuffer = new Float32Array(buffer.length + samples.length);
                newBuffer.set(buffer);
                newBuffer.set(samples, buffer.length);
                buffer = newBuffer;

                while (buffer.length >= CHUNK_SIZE) {
                    const chunk = buffer.slice(0, CHUNK_SIZE);
                    buffer = buffer.slice(CHUNK_SIZE);
                    const resampled = resample(chunk, nativeSampleRate, TARGET_SAMPLE_RATE);
                    const base64 = float32ToBase64PCM16(resampled);
                    options.onData(base64);
                }
            };

            sourceNode.connect(workletNode);
            workletNode.connect(audioContext.destination);
        },

        stop() {
            workletNode?.disconnect();
            sourceNode?.disconnect();
            stream?.getTracks().forEach(t => t.stop());
            audioContext?.close();
            workletNode = null;
            sourceNode = null;
            stream = null;
            audioContext = null;
        }
    };
}
