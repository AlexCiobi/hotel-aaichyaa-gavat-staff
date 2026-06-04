import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../lib/colors';

const KITCHEN_PIN = '5678';

export default function KitchenLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  async function handleLogin() {
    if (pin !== KITCHEN_PIN) { setError('Invalid PIN'); return; }
    await AsyncStorage.setItem('staff_kitchen', JSON.stringify({ loggedInAt: Date.now() }));
    router.replace('/kitchen/display');
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.emoji}>👨‍🍳</Text>
          <Text style={styles.title}>Kitchen Display</Text>
          <Text style={styles.subtitle}>Hotel Aaichyaa Gavat</Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={styles.label}>KITCHEN PIN</Text>
            <TextInput
              value={pin}
              onChangeText={v => { setPin(v); setError(''); }}
              placeholder="Enter PIN"
              placeholderTextColor={COLORS.textDim}
              secureTextEntry
              maxLength={6}
              keyboardType="number-pad"
              style={[styles.input, styles.pinInput]}
            />
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.button} onPress={handleLogin} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Open Kitchen Display</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  back: { position: 'absolute', top: 16, left: 0 },
  backText: { color: COLORS.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular' },
  header: { alignItems: 'center', marginBottom: 40 },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' },
  form: { gap: 16 },
  label: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 8 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    fontFamily: 'Inter_400Regular',
  },
  pinInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22 },
  errorBox: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12 },
  errorText: { color: COLORS.red, fontSize: 13, textAlign: 'center', fontFamily: 'Inter_600SemiBold' },
  button: {
    backgroundColor: COLORS.crimson,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
});
