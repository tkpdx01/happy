/**
 * Native PCM audio playback using expo-audio.
 *
 * Receives base64-encoded PCM 24kHz 16-bit data from Gemini,
 * wraps it in a WAV header, writes to a temp file, and plays it.
 *
 * Uses a queue to handle sequential playback of audio chunks.
 */

import { AudioModule } from 'expo-audio';
import * as FileSystem from 'expo-file-system';

export interface AudioPlayer {
    start(): Promise<void>;
    play(base64PCM: string): void;
    clear(): void;
    stop(): void;
}

const OUTPUT_SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Create a WAV header for raw PCM data.
 */
function createWavHeader(dataLength: number): Uint8Array {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const byteRate = OUTPUT_SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
    const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt chunk
    view.setUint32(12, 0x666D7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, NUM_CHANNELS, true);
    view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, BITS_PER_SAMPLE, true);

    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true);

    return new Uint8Array(header);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function createAudioPlayer(): AudioPlayer {
    let player: InstanceType<typeof AudioModule.AudioPlayer> | null = null;
    let queue: string[] = [];
    let playing = false;
    let stopped = false;
    let fileCounter = 0;

    async function playNext() {
        if (stopped || playing || queue.length === 0) return;
        playing = true;

        const base64PCM = queue.shift()!;

        try {
            // Decode base64 to get raw PCM byte length
            const binaryStr = atob(base64PCM);
            const pcmBytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                pcmBytes[i] = binaryStr.charCodeAt(i);
            }

            // Create WAV with header
            const wavHeader = createWavHeader(pcmBytes.length);
            const wavBytes = new Uint8Array(wavHeader.length + pcmBytes.length);
            wavBytes.set(wavHeader);
            wavBytes.set(pcmBytes, wavHeader.length);
            const wavBase64 = uint8ArrayToBase64(wavBytes);

            // Write to temp file
            const tempFile = `${FileSystem.cacheDirectory}gemini_audio_${fileCounter++}.wav`;
            await FileSystem.writeAsStringAsync(tempFile, wavBase64, {
                encoding: FileSystem.EncodingType.Base64,
            });

            // Play the file
            player = new AudioModule.AudioPlayer(tempFile);
            player.play();

            // Wait for playback to finish, then clean up
            await new Promise<void>((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!player || !player.playing) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 50);
            });

            // Clean up temp file
            await FileSystem.deleteAsync(tempFile, { idempotent: true }).catch(() => {});
        } catch (e) {
            console.error('[NativeAudioPlayer] Playback error:', e);
        }

        playing = false;
        playNext();
    }

    return {
        async start() {
            stopped = false;
            queue = [];
            await AudioModule.setAudioModeAsync({
                playsInSilentMode: true,
            });
        },

        play(base64PCM: string) {
            if (stopped) return;
            queue.push(base64PCM);
            playNext();
        },

        clear() {
            queue = [];
            try {
                player?.pause();
            } catch {
                // Ignore
            }
        },

        stop() {
            stopped = true;
            queue = [];
            try {
                player?.pause();
            } catch {
                // Ignore
            }
            player = null;
        }
    };
}