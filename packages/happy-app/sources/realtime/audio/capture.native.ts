/**
 * Native PCM audio capture using expo-audio.
 *
 * Records audio using expo-audio's recording API, reads PCM data
 * periodically, and delivers base64-encoded 16kHz 16-bit mono chunks.
 *
 * Note: expo-audio's streaming capabilities are limited compared to
 * Web AudioWorklet. We use short recording segments and poll for data.
 */

import { AudioModule, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system';

export interface AudioCaptureOptions {
    onData: (base64PCM: string) => void;
    onError?: (error: Error) => void;
}

export interface AudioCapture {
    start(): Promise<void>;
    stop(): void;
}

export function createAudioCapture(options: AudioCaptureOptions): AudioCapture {
    let recording: any = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    return {
        async start() {
            stopped = false;

            // Configure audio mode for recording
            await AudioModule.setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
            });

            // Use a cycling recording approach: record short segments,
            // read the file, convert to base64, and send
            const startRecordingCycle = async () => {
                if (stopped) return;

                try {
                    recording = new AudioModule.AudioRecorder(
                        RecordingPresets.HIGH_QUALITY
                    );
                    await recording.prepareToRecordAsync();
                    recording.record();

                    // Poll every 200ms — stop recording, read data, restart
                    pollInterval = setInterval(async () => {
                        if (stopped || !recording) return;

                        try {
                            const currentRecording = recording;
                            await currentRecording.stop();
                            const uri = currentRecording.uri;

                            if (uri) {
                                const base64 = await FileSystem.readAsStringAsync(uri, {
                                    encoding: FileSystem.EncodingType.Base64,
                                });
                                if (base64 && base64.length > 0) {
                                    options.onData(base64);
                                }
                                // Clean up temp file
                                await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
                            }

                            // Start next recording segment
                            if (!stopped) {
                                recording = new AudioModule.AudioRecorder(
                                    RecordingPresets.HIGH_QUALITY
                                );
                                await recording.prepareToRecordAsync();
                                recording.record();
                            }
                        } catch (e) {
                            if (!stopped) {
                                options.onError?.(e instanceof Error ? e : new Error(String(e)));
                            }
                        }
                    }, 200);
                } catch (e) {
                    options.onError?.(e instanceof Error ? e : new Error(String(e)));
                }
            };

            await startRecordingCycle();
        },

        stop() {
            stopped = true;
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            try {
                recording?.stop();
            } catch {
                // Ignore stop errors during cleanup
            }
            recording = null;
        }
    };
}