import React, { memo, useCallback, useState } from 'react';
import { TextInput, View, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable } from '@/sync/storage';
import { useUnistyles } from 'react-native-unistyles';
import { findLanguageByCode, getLanguageDisplayName, LANGUAGES } from '@/constants/Languages';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';

type ConnectivityStatus = 'idle' | 'testing' | 'success' | 'error';

/**
 * Test Gemini API connectivity by making a lightweight models.list call.
 * Returns true if the API is reachable with the given key.
 */
async function testGeminiConnectivity(
    apiKey: string,
    baseUrl?: string | null
): Promise<{ ok: boolean; message?: string }> {
    const base = baseUrl || 'https://generativelanguage.googleapis.com';
    const url = `${base}/v1beta/models?key=${apiKey}&pageSize=1`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) return { ok: true };
        if (res.status === 401 || res.status === 403) {
            return { ok: false, message: t('settingsVoice.geminiTestInvalidKey') };
        }
        return { ok: false, message: `HTTP ${res.status}` };
    } catch (e: any) {
        if (e?.name === 'AbortError') {
            return { ok: false, message: t('settingsVoice.geminiTestTimeout') };
        }
        return { ok: false, message: t('settingsVoice.geminiTestNetworkError') };
    }
}

export default memo(function VoiceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable('voiceAssistantLanguage');
    const [voiceEngine, setVoiceEngine] = useSettingMutable('voiceEngine');
    const [geminiApiKey, setGeminiApiKey] = useSettingMutable('geminiApiKey');
    const [geminiBaseUrl, setGeminiBaseUrl] = useSettingMutable('geminiBaseUrl');

    const [connectStatus, setConnectStatus] = useState<ConnectivityStatus>('idle');
    const [connectMessage, setConnectMessage] = useState<string>('');

    const currentLanguage = findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];

    const openAIStudio = useCallback(() => {
        Linking.openURL('https://aistudio.google.com/apikey');
    }, []);

    const handleTestConnection = useCallback(async () => {
        if (!geminiApiKey) return;
        setConnectStatus('testing');
        setConnectMessage('');
        const result = await testGeminiConnectivity(geminiApiKey, geminiBaseUrl);
        if (result.ok) {
            setConnectStatus('success');
            setConnectMessage(t('settingsVoice.geminiTestSuccess'));
        } else {
            setConnectStatus('error');
            setConnectMessage(result.message || t('settingsVoice.geminiTestFailed'));
        }
    }, [geminiApiKey, geminiBaseUrl]);

    const connectStatusIcon = () => {
        switch (connectStatus) {
            case 'testing':
                return <ActivityIndicator size="small" />;
            case 'success':
                return <Ionicons name="checkmark-circle" size={24} color="#34C759" />;
            case 'error':
                return <Ionicons name="close-circle" size={24} color="#FF3B30" />;
            default:
                return null;
        }
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Voice Engine Selection */}
            <ItemGroup
                title={t('settingsVoice.voiceEngine')}
                footer={t('settingsVoice.voiceEngineDescription')}
            >
                <Item
                    title={t('settingsVoice.engineElevenLabs')}
                    icon={<Ionicons name="volume-high-outline" size={29} color="#007AFF" />}
                    onPress={() => setVoiceEngine('elevenlabs')}
                    showChevron={false}
                    rightElement={
                        voiceEngine === 'elevenlabs'
                            ? <Ionicons name="checkmark" size={20} color="#007AFF" />
                            : undefined
                    }
                />
                <Item
                    title={t('settingsVoice.engineGemini')}
                    icon={<Ionicons name="sparkles-outline" size={29} color="#AF52DE" />}
                    onPress={() => setVoiceEngine('gemini')}
                    showChevron={false}
                    rightElement={
                        voiceEngine === 'gemini'
                            ? <Ionicons name="checkmark" size={20} color="#007AFF" />
                            : undefined
                    }
                />
            </ItemGroup>

            {/* Gemini API Key */}
            {voiceEngine === 'gemini' && (
                <>
                    <ItemGroup title={t('settingsVoice.geminiApiKey')}>
                        <View style={styles.inputWrapper}>
                            <TextInput
                                style={[styles.input, {
                                    backgroundColor: theme.colors.input.background,
                                    color: theme.colors.text,
                                    borderColor: theme.colors.textSecondary,
                                }]}
                                value={geminiApiKey ?? ''}
                                onChangeText={(text) => {
                                    setGeminiApiKey(text || null);
                                    setConnectStatus('idle');
                                }}
                                placeholder={t('settingsVoice.geminiApiKeyPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                        <Item
                            title={t('settingsVoice.geminiGetApiKey')}
                            icon={<Ionicons name="open-outline" size={29} color="#34C759" />}
                            onPress={openAIStudio}
                            showChevron={false}
                        />
                    </ItemGroup>

                    {/* Gemini Base URL (proxy) */}
                    <ItemGroup
                        title={t('settingsVoice.geminiBaseUrl')}
                        footer={t('settingsVoice.geminiBaseUrlHint')}
                    >
                        <View style={styles.inputWrapper}>
                            <TextInput
                                style={[styles.input, {
                                    backgroundColor: theme.colors.input.background,
                                    color: theme.colors.text,
                                    borderColor: theme.colors.textSecondary,
                                }]}
                                value={geminiBaseUrl ?? ''}
                                onChangeText={(text) => {
                                    setGeminiBaseUrl(text || null);
                                    setConnectStatus('idle');
                                }}
                                placeholder={t('settingsVoice.geminiBaseUrlPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                            />
                        </View>
                    </ItemGroup>

                    {/* Connection Test */}
                    <ItemGroup>
                        <Item
                            title={t('settingsVoice.geminiTestConnection')}
                            icon={<Ionicons name="wifi-outline" size={29} color="#007AFF" />}
                            onPress={handleTestConnection}
                            disabled={!geminiApiKey || connectStatus === 'testing'}
                            showChevron={false}
                            rightElement={connectStatusIcon()}
                            subtitle={connectMessage || undefined}
                        />
                    </ItemGroup>
                </>
            )}

            {/* Language Settings */}
            <ItemGroup
                title={t('settingsVoice.languageTitle')}
                footer={t('settingsVoice.languageDescription')}
            >
                <Item
                    title={t('settingsVoice.preferredLanguage')}
                    subtitle={t('settingsVoice.preferredLanguageSubtitle')}
                    icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push('/settings/voice/language')}
                />
            </ItemGroup>
        </ItemList>
    );
});

const styles = StyleSheet.create(() => ({
    inputWrapper: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    input: {
        borderRadius: 10,
        padding: 12,
        fontSize: 16,
        borderWidth: 1,
    },
}));