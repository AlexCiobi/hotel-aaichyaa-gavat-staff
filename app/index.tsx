import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../lib/colors';

const ROLES = [
  { key: 'waiter', emoji: '🍽', title: 'Waiter', desc: 'Take orders, manage tables, send to kitchen', route: '/waiter/login', color: COLORS.crimson },
  { key: 'kitchen', emoji: '👨‍🍳', title: 'Kitchen', desc: 'View orders, update cooking status', route: '/kitchen/login', color: '#F97316' },
  { key: 'admin', emoji: '📊', title: 'Admin', desc: 'Tables, reservations, sales & revenue', route: '/admin/login', color: '#3B82F6' },
] as const;

export default function RoleSelect() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>AG</Text>
        </View>
        <Text style={styles.title}>Hotel Aaichyaa Gavat</Text>
        <Text style={styles.tagline}>हक्काची जागा</Text>
        <Text style={styles.subtitle}>Staff Portal</Text>
      </View>

      <View style={styles.cards}>
        {ROLES.map(role => (
          <TouchableOpacity
            key={role.key}
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push(role.route as any)}
          >
            <View style={[styles.cardIcon, { backgroundColor: role.color + '12' }]}>
              <Text style={{ fontSize: 28 }}>{role.emoji}</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{role.title}</Text>
              <Text style={styles.cardDesc}>{role.desc}</Text>
            </View>
            <Text style={[styles.cardArrow, { color: role.color }]}>→</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.footer}>v1.0.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, padding: 24 },
  header: { alignItems: 'center', marginTop: 40, marginBottom: 40 },
  logo: { width: 68, height: 68, borderRadius: 18, backgroundColor: COLORS.crimson, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoText: { color: '#fff', fontSize: 22, fontFamily: 'Inter_700Bold' },
  title: { color: COLORS.text, fontSize: 22, fontFamily: 'PlayfairDisplay_700Bold', textAlign: 'center' },
  tagline: { color: COLORS.crimson, fontSize: 13, marginTop: 2, fontFamily: 'Inter_600SemiBold' },
  subtitle: { color: COLORS.textMuted, fontSize: 13, marginTop: 6, fontFamily: 'Inter_400Regular' },
  cards: { gap: 12, flex: 1, justifyContent: 'center' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1 },
  cardTitle: { color: COLORS.text, fontSize: 17, fontFamily: 'Inter_700Bold' },
  cardDesc: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 16 },
  cardArrow: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  footer: { textAlign: 'center', color: COLORS.textDim, fontSize: 12, marginBottom: 8, fontFamily: 'Inter_400Regular' },
});
