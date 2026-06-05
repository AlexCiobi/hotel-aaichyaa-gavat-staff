import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/colors';
import type { OrderRecord } from '../../lib/types';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; next: string | null; btnLabel: string; btnColor: string }> = {
  placed: { label: 'NEW', color: COLORS.blue, bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', next: 'preparing', btnLabel: 'Start Cooking', btnColor: COLORS.crimson },
  confirmed: { label: 'CONFIRMED', color: COLORS.purple, bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.25)', next: 'preparing', btnLabel: 'Start Cooking', btnColor: COLORS.crimson },
  preparing: { label: 'COOKING', color: COLORS.yellow, bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.25)', next: 'ready', btnLabel: 'Mark Ready', btnColor: COLORS.green },
  ready: { label: 'READY', color: COLORS.green, bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', next: 'delivered', btnLabel: 'Mark Delivered', btnColor: '#059669' },
};

interface TableMap { [id: string]: string }

function timeSince(dateStr: string) {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

type FilterType = 'all' | 'placed' | 'preparing' | 'ready';

export default function KitchenDisplay() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [tableMap, setTableMap] = useState<TableMap>({});
  const [filter, setFilter] = useState<FilterType>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    const [{ data: o }, { data: t }] = await Promise.all([
      supabase.from('orders').select('*')
        .in('order_status', ['placed', 'confirmed', 'preparing', 'ready'])
        .order('created_at', { ascending: false }),
      supabase.from('restaurant_tables').select('id, table_number'),
    ]);
    setOrders(o ?? []);
    setTableMap(Object.fromEntries((t ?? []).map(r => [r.id, r.table_number])));
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('staff_kitchen');
      if (!raw) { router.replace('/kitchen/login'); return; }
    })();
    fetchAll();
  }, [fetchAll]);

  // Real-time
  useEffect(() => {
    const ch = supabase
      .channel('kitchen-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  // Tick timer every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const onRefresh = async () => { setRefreshing(true); await fetchAll(); setRefreshing(false); };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId);
    const { error } = await supabase.from('orders')
      .update({ order_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await supabase.from('order_status_history').insert({ order_id: orderId, status: newStatus, changed_by: 'kitchen' });
      if (newStatus === 'delivered') {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, order_status: newStatus } : o));
      }
    }
    setUpdatingId(null);
  };

  const filtered = filter === 'all' ? orders : orders.filter(o => o.order_status === filter || (filter === 'placed' && o.order_status === 'confirmed'));

  const counts = {
    new: orders.filter(o => o.order_status === 'placed' || o.order_status === 'confirmed').length,
    cooking: orders.filter(o => o.order_status === 'preparing').length,
    ready: orders.filter(o => o.order_status === 'ready').length,
  };

  const logout = async () => {
    await AsyncStorage.removeItem('staff_kitchen');
    router.replace('/kitchen/login');
  };

  return (
    <SafeAreaView style={st.container}>
      {/* Header */}
      <View style={st.header}>
        <View style={st.headerLeft}>
          <View style={st.headerIcon}>
            <Text style={{ fontSize: 18 }}>👨‍🍳</Text>
          </View>
          <View>
            <Text style={st.headerTitle}>Kitchen Display</Text>
            <Text style={st.headerSub}>Hotel Aaichyaa Gavat</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={st.logoutText}>Exit</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={st.filterRow}>
        <TouchableOpacity onPress={() => setFilter('all')} style={[st.filterBtn, filter === 'all' && st.filterBtnActive]}>
          <Text style={[st.filterText, filter === 'all' && st.filterTextActive]}>All ({orders.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('placed')} style={[st.filterBtn, filter === 'placed' && { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
          <Text style={[st.filterText, filter === 'placed' && { color: COLORS.blue }]}>New ({counts.new})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('preparing')} style={[st.filterBtn, filter === 'preparing' && { backgroundColor: 'rgba(234,179,8,0.15)' }]}>
          <Text style={[st.filterText, filter === 'preparing' && { color: COLORS.yellow }]}>Cooking ({counts.cooking})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('ready')} style={[st.filterBtn, filter === 'ready' && { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
          <Text style={[st.filterText, filter === 'ready' && { color: COLORS.green }]}>Ready ({counts.ready})</Text>
        </TouchableOpacity>
      </View>

      {/* Orders */}
      <ScrollView
        contentContainerStyle={st.grid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.crimson} />}
      >
        {filtered.length === 0 && (
          <View style={st.empty}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>👨‍🍳</Text>
            <Text style={st.emptyTitle}>No orders right now</Text>
            <Text style={st.emptyText}>New orders will appear automatically</Text>
          </View>
        )}

        {filtered.map(order => {
          const cfg = STATUS_CONFIG[order.order_status] ?? STATUS_CONFIG.placed;
          const elapsed = timeSince(order.created_at);
          const isOld = parseInt(elapsed) > 15 && elapsed.includes('m');
          const tblName = order.table_id ? tableMap[order.table_id] : null;

          return (
            <View key={order.id} style={[st.card, { borderColor: cfg.border, backgroundColor: cfg.bg }]}>
              {/* Card header */}
              <View style={st.cardHeader}>
                <View style={st.cardHeaderLeft}>
                  <Text style={st.cardOrderNum}>{order.order_number}</Text>
                  {tblName && (
                    <View style={st.tablePill}>
                      <Text style={st.tablePillText}>T-{tblName}</Text>
                    </View>
                  )}
                </View>
                <Text style={[st.cardTime, isOld && { color: COLORS.red }]}>{elapsed}</Text>
              </View>

              {/* Status */}
              <Text style={[st.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
              <Text style={st.orderType}>{order.order_type}</Text>

              {/* Items */}
              <View style={st.itemsList}>
                {Array.isArray(order.items) && order.items.map((item, i) => (
                  <View key={i} style={st.itemRow}>
                    <View style={st.itemQtyBadge}>
                      <Text style={st.itemQtyText}>{item.qty}</Text>
                    </View>
                    <Text style={st.itemName}>{item.name}</Text>
                  </View>
                ))}
              </View>

              {/* Special instructions */}
              {order.special_instructions && (
                <View style={st.noteBox}>
                  <Text style={st.noteText}>{order.special_instructions}</Text>
                </View>
              )}

              {/* Action button */}
              {cfg.next && (
                <TouchableOpacity
                  onPress={() => updateStatus(order.id, cfg.next!)}
                  disabled={updatingId === order.id}
                  style={[st.actionBtn, { backgroundColor: cfg.btnColor }, updatingId === order.id && { opacity: 0.5 }]}
                  activeOpacity={0.8}
                >
                  <Text style={st.actionBtnText}>
                    {updatingId === order.id ? 'Updating...' : cfg.btnLabel}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.crimson, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  headerSub: { color: COLORS.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular' },
  logoutText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  filterRow: { flexDirection: 'row' as const, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  filterBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center' as const, justifyContent: 'center' as const },
  filterBtnActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  filterText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  filterTextActive: { color: '#fff' },

  grid: { padding: 12, paddingBottom: 40, gap: 10 },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { color: 'rgba(255,255,255,0.2)', fontSize: 16, fontFamily: 'Inter_700Bold' },
  emptyText: { color: 'rgba(255,255,255,0.1)', fontSize: 13, marginTop: 4, fontFamily: 'Inter_400Regular' },

  card: { borderRadius: 18, borderWidth: 2, padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardOrderNum: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  tablePill: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  tablePillText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Inter_700Bold' },
  cardTime: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_700Bold' },

  statusLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  orderType: { color: COLORS.textMuted, fontSize: 10, textTransform: 'capitalize', marginBottom: 10, fontFamily: 'Inter_400Regular' },

  itemsList: { gap: 6, marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemQtyBadge: { width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  itemQtyText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  itemName: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },

  noteBox: { backgroundColor: 'rgba(234,179,8,0.06)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(234,179,8,0.1)', marginBottom: 10 },
  noteText: { color: 'rgba(234,179,8,0.7)', fontSize: 11, fontFamily: 'Inter_400Regular' },

  actionBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
});
