/**
 * PCM audio playback utility.
 *
 * Plays back base64-encoded PCM 16-bit audio at 24kHz (Gemini output format)
 * through the browser's audio system using AudioWorklet for gapless streaming.
 */

const PLAYBACK_PROCESSOR_CODE = `
class PCMPlaybackProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(0);
        this.port.onmessage = (event) => {
            if (event.data === 'clear') {
                this._buffer = new Float32Array(0);
                return;
            }
            const incoming = event.data;
            const newBuffer = new Float32Array(this._buffer.length + incoming.length);
            newBuffer.set(this._buffer);
            newBuffer.set(incoming, this._buffer.length);
            this._buffer = newBuffer;
        };
    }

    process(inputs, outputs) {
        const output = outputs[0]?.[0];
        if (!output) return true;

        if (this._buffer.length >= output.length) {
            output.set(this._buffer.subarray(0, output.length));
            this._buffer = this._buffer.slice(output.length);
        } else if (this._buffer.length > 0) {
            output.set(this._buffer);
            output.fill(0, this._buffer.length);
            this._buffer = new Float32Array(0);
        } else {
            output.fill(0);
        }
        return true;
    }
}
registerProcessor('pcm-playback-processor', PCMPlaybackProcessor);
`;

const OUTPUT_SAMPLE_RATE = 24000;

export interface AudioPlayer {
    start(): Promise<void>;
    play(base64PCM: string): void;
    clear(): void;
    stop(): void;
}

function base64PCM16ToFloat32(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x8000;
    }
    return float32;
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

export function createAudioPlayer(): AudioPlayer {
    let audioContext: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let nativeSampleRate = OUTPUT_SAMPLE_RATE;

    return {
        async start() {
            audioContext = new AudioContext();
            nativeSampleRate = audioContext.sampleRate;

            const blob = new Blob([PLAYBACK_PROCESSOR_CODE], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            try {
                await audioContext.audioWorklet.addModule(url);
            } catch {
                const base64 = btoa(PLAYBACK_PROCESSOR_CODE);
                const dataUrl = `data:application/javascript;base64,${base64}`;
                await audioContext.audioWorklet.addModule(dataUrl);
            } finally {
                URL.revokeObjectURL(url);
            }

            workletNode = new AudioWorkletNode(audioContext, 'pcm-playback-processor');
            workletNode.connect(audioContext.destination);
        },

        play(base64PCM: string) {
            if (!workletNode) return;
            const float32 = base64PCM16ToFloat32(base64PCM);
            const resampled = resample(float32, OUTPUT_SAMPLE_RATE, nativeSampleRate);
            workletNode.port.postMessage(resampled);
        },

        clear() {
            workletNode?.port.postMessage('clear');
        },

        stop() {
            workletNode?.disconnect();
            audioContext?.close();
            workletNode = null;
            audioContext = null;
        }
    };
}
