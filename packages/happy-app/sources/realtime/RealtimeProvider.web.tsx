import React from 'react';
import { RealtimeVoiceSession } from './RealtimeVoiceSession';
import { GeminiVoiceSession } from './GeminiVoiceSession';
import { useSettingMutable } from '@/sync/storage';

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
    const [voiceEngine] = useSettingMutable('voiceEngine');

    return (
        <>
            {voiceEngine === 'gemini' ? <GeminiVoiceSession /> : <RealtimeVoiceSession />}
            {children}
        </>
    );
};
