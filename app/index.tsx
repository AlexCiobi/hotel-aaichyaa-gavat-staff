import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../lib/colors';

export default function RoleSelect() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>AG</Text>
        </View>
        <Text style={styles.title}>Hotel Aaichyaa Gavat</Text>
        <Text style={styles.subtitle}>Staff Portal</Text>
      </View>

      <View style={styles.cards}>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => router.push('/waiter/login')}
        >
          <Text style={styles.cardEmoji}>🍽</Text>
          <Text style={styles.cardTitle}>Waiter</Text>
          <Text style={styles.cardDesc}>
            Take orders from tables, browse menu, send to kitchen
          </Text>
          <View style={styles.cardArrow}>
            <Text style={styles.cardArrowText}>Open →</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, styles.cardKitchen]}
          activeOpacity={0.8}
          onPress={() => router.push('/kitchen/login')}
        >
          <Text style={styles.cardEmoji}>👨‍🍳</Text>
          <Text style={styles.cardTitle}>Kitchen</Text>
          <Text style={styles.cardDesc}>
            View incoming orders, update cooking status in real-time
          </Text>
          <View style={[styles.cardArrow, styles.cardArrowKitchen]}>
            <Text style={styles.cardArrowTextKitchen}>Open →</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>v1.0.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 48,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: COLORS.crimson,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoText: {
    color: '#fff',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontFamily: 'PlayfairDisplay_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 4,
    fontFamily: 'Inter_400Regular',
  },
  cards: {
    gap: 16,
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardKitchen: {
    borderColor: 'rgba(192,39,45,0.2)',
    backgroundColor: 'rgba(192,39,45,0.05)',
  },
  cardEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 6,
  },
  cardDesc: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  cardArrow: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.crimson,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  cardArrowKitchen: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.crimson,
  },
  cardArrowText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  cardArrowTextKitchen: {
    color: COLORS.crimson,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.1)',
    fontSize: 12,
    marginBottom: 8,
    fontFamily: 'Inter_400Regular',
  },
});
