import React from 'react';
import { ElevenLabsProvider } from "@elevenlabs/react-native";
import { RealtimeVoiceSession } from './RealtimeVoiceSession';
import { GeminiVoiceSession } from './GeminiVoiceSession';
import { useSettingMutable } from '@/sync/storage';

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
    const [voiceEngine] = useSettingMutable('voiceEngine');

    if (voiceEngine === 'gemini') {
        return (
            <>
                <GeminiVoiceSession />
                {children}
            </>
        );
    }

    return (
        <ElevenLabsProvider>
            <RealtimeVoiceSession />
            {children}
        </ElevenLabsProvider>
    );
};
