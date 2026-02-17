/**
 * Gemini Live API voice session for Native (iOS/Android).
 *
 * Same logic as the Web version but uses expo-audio for
 * audio capture and playback instead of AudioWorklet.
 */

import React, { useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, Type, type LiveServerMessage } from '@google/genai';
import { GEMINI_VOICE_SYSTEM_PROMPT } from './geminiVoicePrompt';
import { registerVoiceSession } from './RealtimeSession';
import { realtimeClientTools } from './realtimeClientTools';
import { storage } from '@/sync/storage';
import { createAudioCapture, createAudioPlayer } from './audio';
import type { AudioCapture, AudioPlayer } from './audio';
import type { VoiceSession, VoiceSessionConfig } from './types';

const DEBUG = __DEV__;

class GeminiVoiceSessionImpl implements VoiceSession {
    private session: any = null;
    private audioCapture: AudioCapture | null = null;
    private audioPlayer: AudioPlayer | null = null;

    async startSession(config: VoiceSessionConfig): Promise<void> {
        storage.getState().setRealtimeStatus('connecting');

        const settings = storage.getState().settings;
        const apiKey = settings.geminiApiKey;
        if (!apiKey) {
            storage.getState().setRealtimeStatus('error');
            throw new Error('Gemini API key not configured');
        }

        // Initialize audio
        this.audioPlayer = createAudioPlayer();
        await this.audioPlayer.start();

        this.audioCapture = createAudioCapture({
            onData: (base64PCM) => {
                if (!this.session) return;
                try {
                    this.session.sendRealtimeInput({
                        media: {
                            data: base64PCM,
                            mimeType: 'audio/pcm;rate=16000',
                        },
                    });
                } catch (e) {
                    if (DEBUG) console.error('[GeminiVoice] Error sending audio:', e);
                }
            },
            onError: (error) => {
                console.error('[GeminiVoice] Audio capture error:', error);
                storage.getState().setRealtimeStatus('error');
            },
        });

        try {
            await this.audioCapture.start();
        } catch (error) {
            console.error('[GeminiVoice] Failed to start audio capture:', error);
            this.audioPlayer.stop();
            storage.getState().setRealtimeStatus('error');
            throw error;
        }

        // Connect to Gemini Live API
        const aiOptions: any = { apiKey };
        const baseUrl = settings.geminiBaseUrl;
        if (baseUrl) {
            aiOptions.httpOptions = { baseUrl };
        }
        const ai = new GoogleGenAI(aiOptions);

        try {
            this.session = await ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-latest',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: {
                        parts: [{ text: GEMINI_VOICE_SYSTEM_PROMPT }],
                    },
                    tools: [{
                        functionDeclarations: [
                            {
                                name: 'messageClaudeCode',
                                description: 'Send a message to the active coding agent. Use when the user wants to give instructions, ask questions about code, or request any development task.',
                                parameters: {
                                    type: Type.OBJECT,
                                    properties: {
                                        message: { type: Type.STRING, description: 'The full message to send to the coding agent' },
                                    },
                                    required: ['message'],
                                },
                            },
                            {
                                name: 'processPermissionRequest',
                                description: 'Approve or deny a pending permission request from the coding agent.',
                                parameters: {
                                    type: Type.OBJECT,
                                    properties: {
                                        decision: { type: Type.STRING, description: 'The decision: "allow" or "deny"' },
                                    },
                                    required: ['decision'],
                                },
                            },
                        ],
                    }],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' }
                        }
                    },
                },
                callbacks: {
                    onopen: () => {
                        if (DEBUG) console.log('[GeminiVoice] Connected');
                        storage.getState().setRealtimeStatus('connected');
                        storage.getState().setRealtimeMode('idle');
                    },
                    onmessage: (message: LiveServerMessage) => {
                        this.handleServerMessage(message);
                    },
                    onerror: (error: ErrorEvent) => {
                        console.error('[GeminiVoice] WebSocket error:', error);
                        storage.getState().setRealtimeStatus('error');
                    },
                    onclose: (_event: CloseEvent) => {
                        if (DEBUG) console.log('[GeminiVoice] Disconnected');
                        storage.getState().setRealtimeStatus('disconnected');
                        storage.getState().setRealtimeMode('idle', true);
                    },
                },
            });

            if (config.initialContext) {
                this.session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: `[CONTEXT UPDATE] ${config.initialContext}` }] }],
                    turnComplete: true,
                });
            }
        } catch (error) {
            console.error('[GeminiVoice] Failed to connect:', error);
            this.audioCapture.stop();
            this.audioPlayer.stop();
            storage.getState().setRealtimeStatus('error');
            throw error;
        }
    }

    async endSession(): Promise<void> {
        try {
            this.session?.close();
        } catch (e) {
            if (DEBUG) console.error('[GeminiVoice] Error closing session:', e);
        }
        this.audioCapture?.stop();
        this.audioPlayer?.stop();
        this.session = null;
        this.audioCapture = null;
        this.audioPlayer = null;
        storage.getState().setRealtimeStatus('disconnected');
        storage.getState().setRealtimeMode('idle', true);
    }

    sendTextMessage(message: string): void {
        if (!this.session) return;
        this.session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: message }] }],
            turnComplete: true,
        });
    }

    sendContextualUpdate(update: string): void {
        if (!this.session) return;
        this.session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: `[CONTEXT UPDATE] ${update}` }] }],
            turnComplete: true,
        });
    }

    private handleServerMessage(message: LiveServerMessage) {
        const parts = (message as any).serverContent?.modelTurn?.parts;
        if (parts) {
            for (const part of parts) {
                if (part.inlineData?.data && part.inlineData.mimeType?.includes('audio')) {
                    this.audioPlayer?.play(part.inlineData.data);
                    storage.getState().setRealtimeMode('speaking');
                }
            }
        }

        if ((message as any).serverContent?.turnComplete) {
            storage.getState().setRealtimeMode('idle');
        }

        const toolCall = (message as any).toolCall;
        if (toolCall?.functionCalls) {
            this.handleToolCalls(toolCall.functionCalls);
        }
    }

    private async handleToolCalls(functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>) {
        const responses: Array<{ id: string; name: string; response: unknown }> = [];

        for (const call of functionCalls) {
            if (!call.name || !call.id) continue;
            if (DEBUG) console.log('[GeminiVoice] Tool call:', call.name, call.args);

            let result: string = 'error (unknown tool)';
            if (call.name === 'messageClaudeCode') {
                result = await realtimeClientTools.messageClaudeCode(call.args ?? {});
            } else if (call.name === 'processPermissionRequest') {
                result = await realtimeClientTools.processPermissionRequest(call.args ?? {});
            }

            responses.push({ id: call.id, name: call.name, response: { result } });
        }

        if (responses.length > 0 && this.session) {
            this.session.sendToolResponse({ functionResponses: responses });
        }
    }
}

export const GeminiVoiceSession: React.FC = () => {
    const hasRegistered = useRef(false);

    useEffect(() => {
        if (!hasRegistered.current) {
            registerVoiceSession(new GeminiVoiceSessionImpl());
            hasRegistered.current = true;
        }
    }, []);

    return null;
};
