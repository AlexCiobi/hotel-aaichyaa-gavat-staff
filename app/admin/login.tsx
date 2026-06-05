import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

const ADMIN_PIN = '9999';

export default function AdminLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  async function handleLogin() {
    if (pin !== ADMIN_PIN) { setError('Invalid PIN'); return; }
    await AsyncStorage.setItem('staff_admin', JSON.stringify({ loggedInAt: Date.now() }));
    router.replace('/admin/panel');
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Text style={{ fontSize: 36 }}>📊</Text>
          </View>
          <Text style={styles.title}>Admin Panel</Text>
          <Text style={styles.subtitle}>Hotel Aaichyaa Gavat</Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={styles.label}>ADMIN PIN</Text>
            <TextInput
              value={pin}
              onChangeText={v => { setPin(v); setError(''); }}
              placeholder="Enter PIN"
              placeholderTextColor="#CCCCCC"
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
            <Text style={styles.buttonText}>Open Admin Panel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  back: { position: 'absolute', top: 16, left: 0 },
  backText: { color: '#999999', fontSize: 14, fontFamily: 'Inter_400Regular' },
  header: { alignItems: 'center', marginBottom: 40 },
  iconWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: 'rgba(59,130,246,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { color: '#1A1A1A', fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { color: '#999999', fontSize: 12, marginTop: 4, fontFamily: 'Inter_400Regular' },
  form: { gap: 16 },
  label: { color: '#999999', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 8 },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    fontFamily: 'Inter_400Regular',
  },
  pinInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22 },
  errorBox: { backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 10, padding: 12 },
  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center', fontFamily: 'Inter_600SemiBold' },
  button: { backgroundColor: '#3B82F6', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
});
