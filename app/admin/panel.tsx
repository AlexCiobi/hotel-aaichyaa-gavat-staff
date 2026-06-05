import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import type { RestaurantTable, OrderRecord } from '../../lib/types';

type AdminTab = 'dashboard' | 'tables' | 'reservations' | 'sales';

interface Reservation {
  id: string;
  booking_ref: string;
  customer_name: string;
  whatsapp_number: string;
  date: string;
  time: string;
  guest_count: number;
  occasion: string;
  status: string;
  created_at: string;
}

export default function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [allOrders, setAllOrders] = useState<OrderRecord[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [{ data: t }, { data: active }, { data: all }, { data: r }] = await Promise.all([
      supabase.from('restaurant_tables').select('*').order('table_number'),
      supabase.from('orders').select('*')
        .in('order_status', ['placed', 'confirmed', 'preparing', 'ready'])
        .order('created_at', { ascending: false }),
      supabase.from('orders').select('*')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('reservations').select('*')
        .order('date', { ascending: false })
        .limit(50),
    ]);
    setTables(t ?? []);
    setOrders(active ?? []);
    setAllOrders(all ?? []);
    setReservations(r ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('staff_admin');
      if (!raw) { router.replace('/admin/login'); return; }
    })();
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const ch = supabase
      .channel('admin-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const onRefresh = async () => { setRefreshing(true); await fetchAll(); setRefreshing(false); };

  const logout = async () => {
    await AsyncStorage.removeItem('staff_admin');
    router.replace('/admin/login');
  };

  // Stats calculations
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = allOrders.filter(o => o.created_at?.startsWith(todayStr));
  const todayRevenue = todayOrders.reduce((s, o) => s + (o.total || o.subtotal || 0), 0);
  const activeOrderCount = orders.length;
  const availableTables = tables.filter(t => t.status === 'available').length;
  const occupiedTables = tables.filter(t => t.status === 'occupied').length;

  // Monthly revenue
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthOrders = allOrders.filter(o => o.created_at >= monthStart);
  const monthRevenue = monthOrders.reduce((s, o) => s + (o.total || o.subtotal || 0), 0);

  // Last 7 days breakdown
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOrders = allOrders.filter(o => o.created_at?.startsWith(dateStr));
    return {
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
      orders: dayOrders.length,
      revenue: dayOrders.reduce((s, o) => s + (o.total || o.subtotal || 0), 0),
    };
  }).reverse();

  const updateTableStatus = async (tableId: string, status: string) => {
    const { error } = await supabase.from('restaurant_tables').update({ status }).eq('id', tableId);
    if (error) Alert.alert('Error', error.message);
    else fetchAll();
  };

  const updateReservationStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('reservations').update({ status }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
    else fetchAll();
  };

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      </SafeAreaView>
    );
  }

  const TABS: { key: AdminTab; label: string; emoji: string }[] = [
    { key: 'dashboard', label: 'Home', emoji: '📊' },
    { key: 'tables', label: 'Tables', emoji: '🪑' },
    { key: 'reservations', label: 'Reserve', emoji: '📅' },
    { key: 'sales', label: 'Sales', emoji: '💰' },
  ];

  return (
    <SafeAreaView style={st.container}>
      {/* Header */}
      <View style={st.header}>
        <View style={st.headerLeft}>
          <View style={st.headerIcon}>
            <Text style={{ fontSize: 16, color: '#fff' }}>AG</Text>
          </View>
          <View>
            <Text style={st.headerTitle}>Admin Panel</Text>
            <Text style={st.headerSub}>Hotel Aaichyaa Gavat</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={st.logoutText}>Exit</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={st.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[st.tabBtn, tab === t.key && st.tabBtnActive]}>
            <Text style={{ fontSize: 16 }}>{t.emoji}</Text>
            <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}
      >
        {/* ===== DASHBOARD ===== */}
        {tab === 'dashboard' && (
          <>
            <Text style={st.sectionTitle}>Overview</Text>
            <View style={st.statsGrid}>
              {[
                { label: 'Today Revenue', value: `Rs.${todayRevenue}`, color: '#16A34A', bg: 'rgba(34,197,94,0.08)' },
                { label: 'Active Orders', value: String(activeOrderCount), color: '#2563EB', bg: 'rgba(59,130,246,0.08)' },
                { label: 'Tables Free', value: `${availableTables}/${tables.length}`, color: '#F97316', bg: 'rgba(249,115,22,0.08)' },
                { label: 'Today Orders', value: String(todayOrders.length), color: '#7C3AED', bg: 'rgba(168,85,247,0.08)' },
              ].map((stat, i) => (
                <View key={i} style={[st.statCard, { backgroundColor: stat.bg }]}>
                  <Text style={[st.statValue, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={st.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>

            <Text style={[st.sectionTitle, { marginTop: 24 }]}>Active Orders</Text>
            {orders.length === 0 ? (
              <Text style={st.emptyText}>No active orders</Text>
            ) : (
              orders.slice(0, 5).map(order => (
                <View key={order.id} style={st.listCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={st.listTitle}>{order.order_number}</Text>
                    <View style={[st.badge, { backgroundColor: order.order_status === 'ready' ? 'rgba(34,197,94,0.1)' : order.order_status === 'preparing' ? 'rgba(234,179,8,0.1)' : 'rgba(59,130,246,0.1)' }]}>
                      <Text style={[st.badgeText, { color: order.order_status === 'ready' ? '#16A34A' : order.order_status === 'preparing' ? '#B8860B' : '#2563EB' }]}>{order.order_status.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={st.listSub}>{order.order_type} · Rs.{order.total || order.subtotal}</Text>
                </View>
              ))
            )}
          </>
        )}

        {/* ===== TABLES ===== */}
        {tab === 'tables' && (
          <>
            <Text style={st.sectionTitle}>Table Management</Text>
            <View style={st.tableStatusRow}>
              <View style={[st.tableStatusPill, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
                <Text style={{ color: '#16A34A', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{availableTables} Free</Text>
              </View>
              <View style={[st.tableStatusPill, { backgroundColor: 'rgba(249,115,22,0.1)' }]}>
                <Text style={{ color: '#F97316', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{occupiedTables} Occupied</Text>
              </View>
              <View style={[st.tableStatusPill, { backgroundColor: 'rgba(168,85,247,0.1)' }]}>
                <Text style={{ color: '#7C3AED', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{tables.filter(t => t.status === 'reserved').length} Reserved</Text>
              </View>
            </View>

            {tables.map(table => (
              <View key={table.id} style={st.listCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View>
                    <Text style={st.listTitle}>Table {table.table_number}</Text>
                    <Text style={st.listSub}>{table.capacity} seats · {table.zone}</Text>
                  </View>
                  <View style={[st.badge, {
                    backgroundColor: table.status === 'available' ? 'rgba(34,197,94,0.1)' : table.status === 'occupied' ? 'rgba(249,115,22,0.1)' : 'rgba(168,85,247,0.1)'
                  }]}>
                    <Text style={[st.badgeText, {
                      color: table.status === 'available' ? '#16A34A' : table.status === 'occupied' ? '#F97316' : '#7C3AED'
                    }]}>{table.status.toUpperCase()}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {table.status !== 'available' && (
                    <TouchableOpacity
                      onPress={() => updateTableStatus(table.id, 'available')}
                      style={[st.actionBtnSmall, { backgroundColor: '#16A34A' }]}
                    >
                      <Text style={st.actionBtnSmallText}>Mark Free</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'occupied' && (
                    <TouchableOpacity
                      onPress={() => updateTableStatus(table.id, 'occupied')}
                      style={[st.actionBtnSmall, { backgroundColor: '#F97316' }]}
                    >
                      <Text style={st.actionBtnSmallText}>Mark Occupied</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'reserved' && (
                    <TouchableOpacity
                      onPress={() => updateTableStatus(table.id, 'reserved')}
                      style={[st.actionBtnSmall, { backgroundColor: '#7C3AED' }]}
                    >
                      <Text style={st.actionBtnSmallText}>Reserve</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        {/* ===== RESERVATIONS ===== */}
        {tab === 'reservations' && (
          <>
            <Text style={st.sectionTitle}>Reservations</Text>
            {reservations.length === 0 ? (
              <Text style={st.emptyText}>No reservations yet</Text>
            ) : (
              reservations.map(res => (
                <View key={res.id} style={st.listCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <View>
                      <Text style={st.listTitle}>{res.customer_name}</Text>
                      <Text style={st.listSub}>{res.booking_ref}</Text>
                    </View>
                    <View style={[st.badge, {
                      backgroundColor: res.status === 'confirmed' ? 'rgba(34,197,94,0.1)' : res.status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)'
                    }]}>
                      <Text style={[st.badgeText, {
                        color: res.status === 'confirmed' ? '#16A34A' : res.status === 'cancelled' ? '#EF4444' : '#B8860B'
                      }]}>{res.status?.toUpperCase() || 'PENDING'}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
                    <Text style={st.listSub}>📅 {res.date}</Text>
                    <Text style={st.listSub}>🕐 {res.time}</Text>
                    <Text style={st.listSub}>👥 {res.guest_count}</Text>
                    {res.occasion ? <Text style={st.listSub}>🎉 {res.occasion}</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {res.status !== 'confirmed' && (
                      <TouchableOpacity
                        onPress={() => updateReservationStatus(res.id, 'confirmed')}
                        style={[st.actionBtnSmall, { backgroundColor: '#16A34A' }]}
                      >
                        <Text style={st.actionBtnSmallText}>Confirm</Text>
                      </TouchableOpacity>
                    )}
                    {res.status !== 'cancelled' && (
                      <TouchableOpacity
                        onPress={() => updateReservationStatus(res.id, 'cancelled')}
                        style={[st.actionBtnSmall, { backgroundColor: '#EF4444' }]}
                      >
                        <Text style={st.actionBtnSmallText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* ===== SALES ===== */}
        {tab === 'sales' && (
          <>
            <Text style={st.sectionTitle}>Sales Overview</Text>
            <View style={st.statsGrid}>
              {[
                { label: 'Today', value: `Rs.${todayRevenue}`, sub: `${todayOrders.length} orders`, color: '#16A34A' },
                { label: 'This Month', value: `Rs.${monthRevenue}`, sub: `${monthOrders.length} orders`, color: '#2563EB' },
              ].map((stat, i) => (
                <View key={i} style={[st.statCard, { backgroundColor: stat.color + '0A' }]}>
                  <Text style={[st.statValue, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={st.statLabel}>{stat.label}</Text>
                  <Text style={[st.statLabel, { marginTop: 2, fontSize: 10 }]}>{stat.sub}</Text>
                </View>
              ))}
            </View>

            <Text style={[st.sectionTitle, { marginTop: 24 }]}>Last 7 Days</Text>
            {last7Days.map((day, i) => (
              <View key={i} style={st.dayRow}>
                <Text style={st.dayLabel}>{day.label}</Text>
                <View style={st.dayBar}>
                  <View style={[st.dayBarFill, { width: `${Math.min(100, (day.revenue / Math.max(...last7Days.map(d => d.revenue), 1)) * 100)}%` }]} />
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                  <Text style={st.dayRevenue}>Rs.{day.revenue}</Text>
                  <Text style={st.dayOrders}>{day.orders} orders</Text>
                </View>
              </View>
            ))}

            <Text style={[st.sectionTitle, { marginTop: 24 }]}>Recent Orders</Text>
            {allOrders.slice(0, 10).map(order => (
              <View key={order.id} style={st.listCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={st.listTitle}>{order.order_number}</Text>
                    <Text style={st.listSub}>
                      {order.order_type} · {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#16A34A', fontFamily: 'Inter_700Bold', fontSize: 14 }}>Rs.{order.total || order.subtotal}</Text>
                    <View style={[st.badge, {
                      backgroundColor: order.order_status === 'delivered' ? 'rgba(34,197,94,0.1)' : order.order_status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)'
                    }]}>
                      <Text style={[st.badgeText, {
                        color: order.order_status === 'delivered' ? '#16A34A' : order.order_status === 'cancelled' ? '#EF4444' : '#2563EB'
                      }]}>{order.order_status.toUpperCase()}</Text>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#1A1A1A', fontSize: 15, fontFamily: 'Inter_700Bold' },
  headerSub: { color: '#999999', fontSize: 10, fontFamily: 'Inter_400Regular' },
  logoutText: { color: '#999999', fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  tabRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEEEEE', paddingHorizontal: 4 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#3B82F6' },
  tabLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#999999' },
  tabLabelActive: { color: '#3B82F6' },

  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { color: '#1A1A1A', fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  emptyText: { color: '#999999', textAlign: 'center', paddingVertical: 40, fontFamily: 'Inter_400Regular' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '48%' as any, borderRadius: 14, padding: 16 },
  statValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { color: '#666666', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  listCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#EEEEEE' },
  listTitle: { color: '#1A1A1A', fontSize: 15, fontFamily: 'Inter_700Bold' },
  listSub: { color: '#999999', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  actionBtnSmall: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  actionBtnSmallText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },

  tableStatusRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tableStatusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  dayLabel: { color: '#666666', fontSize: 12, fontFamily: 'Inter_600SemiBold', width: 60 },
  dayBar: { flex: 1, height: 8, backgroundColor: '#F0F0F0', borderRadius: 4, overflow: 'hidden' },
  dayBarFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 4 },
  dayRevenue: { color: '#1A1A1A', fontSize: 13, fontFamily: 'Inter_700Bold' },
  dayOrders: { color: '#999999', fontSize: 10, fontFamily: 'Inter_400Regular' },
});
