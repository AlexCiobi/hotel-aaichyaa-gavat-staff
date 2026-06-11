import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, RefreshControl, ActivityIndicator, Image, TextInput,
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
  const [billOrder, setBillOrder] = useState<OrderRecord | null>(null);
  const [billTableOrders, setBillTableOrders] = useState<OrderRecord[]>([]);
  const [billPayment, setBillPayment] = useState<'cash' | 'online' | 'split'>('cash');
  const [billCashGiven, setBillCashGiven] = useState('');
  const [billSplitCash, setBillSplitCash] = useState('');
  const [billSplitOnline, setBillSplitOnline] = useState('');

  const fetchAll = useCallback(async () => {
    const [{ data: t }, { data: active }, { data: all }, { data: r }] = await Promise.all([
      supabase.from('restaurant_tables').select('*').order('table_number'),
      supabase.from('orders').select('*')
        .in('order_status', ['placed', 'confirmed', 'preparing', 'ready', 'delivered'])
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

  // Cash vs Online settlement
  const paidOrders = allOrders.filter(o => o.payment_method);
  let cashTotal = 0, onlineTotal = 0;
  paidOrders.forEach(o => {
    const amt = o.total || o.subtotal || 0;
    const pm = o.payment_method || '';
    if (pm.startsWith('split:')) {
      cashTotal += Number(pm.match(/cash=(\d+)/)?.[1] || 0);
      onlineTotal += Number(pm.match(/online=(\d+)/)?.[1] || 0);
    } else if (pm === 'online') {
      onlineTotal += amt;
    } else if (pm === 'cash') {
      cashTotal += amt;
    }
  });

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

  const tableForId = (id: string | null) => tables.find(t => t.id === id);

  const openTableBill = (order: OrderRecord) => {
    // Search both active and all orders to find table-grouped orders (for bill history)
    const searchPool = [...orders, ...allOrders.filter(ao => !orders.find(o => o.id === ao.id))];
    const tableOrders = order.table_id
      ? searchPool.filter(o => o.table_id === order.table_id && o.order_status !== 'cancelled')
      : [order];
    setBillTableOrders(tableOrders.length > 0 ? tableOrders : [order]);
    setBillOrder(order);
    setBillCashGiven('');
    setBillSplitCash('');
    setBillSplitOnline('');
    setBillPayment(order.payment_method?.startsWith('split') ? 'split' : order.payment_method === 'online' ? 'online' : 'cash');
  };

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
          <Image source={require('../../assets/logo.png')} style={st.headerIcon} />
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
                  <TouchableOpacity onPress={() => openTableBill(order)} style={st.billBtn}>
                    <Text style={st.billBtnText}>Generate Bill</Text>
                  </TouchableOpacity>
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

            <Text style={{ color: '#1A1A1A', fontSize: 14, fontFamily: 'Inter_700Bold', marginTop: 8, marginBottom: 6 }}>Main Section</Text>
            {tables.filter(t => t.zone === 'main').map(table => (
              <View key={table.id} style={st.listCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View>
                    <Text style={st.listTitle}>Table {table.table_number}</Text>
                    <Text style={st.listSub}>{table.capacity} seats</Text>
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
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'available')} style={[st.actionBtnSmall, { backgroundColor: '#16A34A' }]}>
                      <Text style={st.actionBtnSmallText}>Mark Free</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'occupied' && (
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'occupied')} style={[st.actionBtnSmall, { backgroundColor: '#F97316' }]}>
                      <Text style={st.actionBtnSmallText}>Mark Occupied</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'reserved' && (
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'reserved')} style={[st.actionBtnSmall, { backgroundColor: '#7C3AED' }]}>
                      <Text style={st.actionBtnSmallText}>Reserve</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            <Text style={{ color: '#1A1A1A', fontSize: 14, fontFamily: 'Inter_700Bold', marginTop: 16, marginBottom: 6 }}>Family Section</Text>
            {tables.filter(t => t.zone === 'family').map(table => (
              <View key={table.id} style={st.listCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View>
                    <Text style={st.listTitle}>Table {table.table_number}</Text>
                    <Text style={st.listSub}>{table.capacity} seats</Text>
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
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'available')} style={[st.actionBtnSmall, { backgroundColor: '#16A34A' }]}>
                      <Text style={st.actionBtnSmallText}>Mark Free</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'occupied' && (
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'occupied')} style={[st.actionBtnSmall, { backgroundColor: '#F97316' }]}>
                      <Text style={st.actionBtnSmallText}>Mark Occupied</Text>
                    </TouchableOpacity>
                  )}
                  {table.status !== 'reserved' && (
                    <TouchableOpacity onPress={() => updateTableStatus(table.id, 'reserved')} style={[st.actionBtnSmall, { backgroundColor: '#7C3AED' }]}>
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

            <Text style={[st.sectionTitle, { marginTop: 24 }]}>Settlement Breakdown</Text>
            <View style={st.statsGrid}>
              {[
                { label: 'Cash Collected', value: `Rs.${cashTotal}`, color: '#16A34A' },
                { label: 'Online Received', value: `Rs.${onlineTotal}`, color: '#2563EB' },
              ].map((stat, i) => (
                <View key={i} style={[st.statCard, { backgroundColor: stat.color + '0A' }]}>
                  <Text style={[st.statValue, { color: stat.color, fontSize: 20 }]}>{stat.value}</Text>
                  <Text style={st.statLabel}>{stat.label}</Text>
                </View>
              ))}
              <View style={[st.statCard, { backgroundColor: '#C027100A', width: '100%' as any }]}>
                <Text style={[st.statValue, { color: '#C02710', fontSize: 20 }]}>Rs.{cashTotal + onlineTotal}</Text>
                <Text style={st.statLabel}>Total Settlement</Text>
              </View>
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

            <Text style={[st.sectionTitle, { marginTop: 24 }]}>Bill History (Last 24h)</Text>
            {(() => {
              const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
              const settledOrders = allOrders.filter(o =>
                o.payment_status === 'paid' && o.payment_method && o.created_at >= oneDayAgo
              );
              if (settledOrders.length === 0) return <Text style={st.emptyText}>No settled bills in the last 24 hours</Text>;
              return settledOrders.map(order => (
                <View key={order.id} style={st.listCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.listTitle}>{order.order_number}</Text>
                      <Text style={st.listSub}>
                        {order.order_type} · {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      <Text style={{ color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                        Payment: {order.payment_method?.startsWith('split:')
                          ? `Split - Cash: Rs.${order.payment_method.match(/cash=(\d+)/)?.[1] || 0} + Online: Rs.${order.payment_method.match(/online=(\d+)/)?.[1] || 0}`
                          : order.payment_method === 'online' ? 'Online' : 'Cash'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: '#16A34A', fontFamily: 'Inter_700Bold', fontSize: 14 }}>Rs.{order.total || order.subtotal}</Text>
                      <TouchableOpacity onPress={() => openTableBill(order)} style={{ marginTop: 4 }}>
                        <Text style={{ color: '#2563EB', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>View Bill</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ));
            })()}

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

            {/* Reset Data */}
            <Text style={[st.sectionTitle, { marginTop: 32 }]}>Reset Data</Text>
            <View style={st.listCard}>
              <Text style={{ color: '#EF4444', fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 10 }}>
                Warning: These actions cannot be undone.
              </Text>
              <View style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => Alert.alert('Reset Orders', 'Delete ALL orders and revenue data? This cannot be undone.', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes, Reset Orders', style: 'destructive', onPress: async () => {
                      await supabase.from('order_status_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      await supabase.from('restaurant_tables').update({ status: 'available' }).neq('id', '00000000-0000-0000-0000-000000000000');
                      Alert.alert('Done', 'All orders cleared, tables freed.');
                      fetchAll();
                    }},
                  ])}
                  style={[st.resetBtn, { borderColor: '#EF4444' }]}
                >
                  <Text style={[st.resetBtnText, { color: '#EF4444' }]}>Reset Orders & Revenue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert('Reset Reservations', 'Delete ALL reservations? This cannot be undone.', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes, Reset', style: 'destructive', onPress: async () => {
                      await supabase.from('reservations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      Alert.alert('Done', 'All reservations cleared.');
                      fetchAll();
                    }},
                  ])}
                  style={[st.resetBtn, { borderColor: '#F97316' }]}
                >
                  <Text style={[st.resetBtnText, { color: '#F97316' }]}>Reset Reservations</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert('Reset Everything', 'Delete ALL orders, reservations, and free all tables? This cannot be undone.', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes, Reset All', style: 'destructive', onPress: async () => {
                      await supabase.from('order_status_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      await supabase.from('reservations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                      await supabase.from('restaurant_tables').update({ status: 'available' }).neq('id', '00000000-0000-0000-0000-000000000000');
                      Alert.alert('Done', 'Everything has been reset.');
                      fetchAll();
                    }},
                  ])}
                  style={{ backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' }}>Reset Everything</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* ====== BILL MODAL (consolidated per table) ====== */}
      {billOrder && (() => {
        const sorted = [...billTableOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const firstOrder = sorted[0];
        const addOnOrders = sorted.slice(1);

        const mainItems: { name: string; name_mr?: string; qty: number; price: number }[] = [];
        if (firstOrder && Array.isArray(firstOrder.items)) {
          firstOrder.items.forEach((item: any) => {
            const existing = mainItems.find(a => a.name === item.name && a.price === item.price);
            if (existing) { existing.qty += item.qty; }
            else { mainItems.push({ name: item.name, name_mr: item.name_mr, qty: item.qty, price: item.price }); }
          });
        }

        const addOnItems: { name: string; name_mr?: string; qty: number; price: number }[] = [];
        addOnOrders.forEach(o => {
          if (Array.isArray(o.items)) {
            o.items.forEach((item: any) => {
              const existing = addOnItems.find(a => a.name === item.name && a.price === item.price);
              if (existing) { existing.qty += item.qty; }
              else { addOnItems.push({ name: item.name, name_mr: item.name_mr, qty: item.qty, price: item.price }); }
            });
          }
        });

        const allItems = [...mainItems, ...addOnItems];
        const billTotal = allItems.reduce((s, i) => s + i.price * i.qty, 0);
        const tbl = billOrder.table_id ? tableForId(billOrder.table_id) : null;

        return (
        <View style={st.billOverlay}>
          <View style={st.billModal}>
            <ScrollView>
              <View style={{ alignItems: 'center', marginBottom: 8 }}>
                <Image source={require('../../assets/logo.png')} style={{ width: 50, height: 50, borderRadius: 25, alignSelf: 'center' }} />
                <Text style={{ color: '#1A1A1A', fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 8, textAlign: 'center' }}>Hotel Aaichyaa Gavat</Text>
                <Text style={{ color: '#E53E3E', fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2, textAlign: 'center' }}>हक्काची जागा</Text>
                <View style={st.billDivider} />
                {tbl && <Text style={st.billInfo}>Table: {tbl.table_number}</Text>}
                <Text style={st.billInfo}>Date: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                <Text style={st.billInfo}>Time: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
                {billTableOrders.length > 1 && (
                  <Text style={[st.billInfo, { color: '#E53E3E', fontFamily: 'Inter_600SemiBold', marginTop: 4 }]}>
                    {billTableOrders.length} orders combined
                  </Text>
                )}
                {billTableOrders.map(o => (
                  <Text key={o.id} style={[st.billInfo, { fontSize: 10, color: '#999' }]}>{o.order_number}</Text>
                ))}
              </View>

              <View style={st.billDivider} />
              <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EEEEEE' }}>
                <Text style={[st.billItemText, { flex: 1, fontFamily: 'Inter_700Bold' }]}>Item</Text>
                <Text style={[st.billItemText, { width: 30, textAlign: 'center', fontFamily: 'Inter_700Bold' }]}>Qty</Text>
                <Text style={[st.billItemText, { width: 60, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Price</Text>
                <Text style={[st.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Total</Text>
              </View>
              {mainItems.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.billItemText}>{item.name_mr || item.name}</Text>
                    {item.name_mr && <Text style={{ color: '#999', fontSize: 9, fontFamily: 'Inter_400Regular' }}>{item.name}</Text>}
                  </View>
                  <Text style={[st.billItemText, { width: 30, textAlign: 'center' }]}>{item.qty}</Text>
                  <Text style={[st.billItemText, { width: 60, textAlign: 'right' }]}>Rs.{item.price}</Text>
                  <Text style={[st.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Rs.{item.price * item.qty}</Text>
                </View>
              ))}

              {addOnItems.length > 0 && (
                <>
                  <View style={[st.billDivider, { marginVertical: 6 }]} />
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: '#E53E3E', marginBottom: 6, textAlign: 'center' }}>— Extra Add-ons —</Text>
                  {addOnItems.map((item, i) => (
                    <View key={`addon-${i}`} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.billItemText}>{item.name_mr || item.name}</Text>
                        {item.name_mr && <Text style={{ color: '#999', fontSize: 9, fontFamily: 'Inter_400Regular' }}>{item.name}</Text>}
                      </View>
                      <Text style={[st.billItemText, { width: 30, textAlign: 'center' }]}>{item.qty}</Text>
                      <Text style={[st.billItemText, { width: 60, textAlign: 'right' }]}>Rs.{item.price}</Text>
                      <Text style={[st.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Rs.{item.price * item.qty}</Text>
                    </View>
                  ))}
                </>
              )}

              <View style={st.billDivider} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: '#1A1A1A', fontSize: 16, fontFamily: 'Inter_700Bold' }}>TOTAL</Text>
                <Text style={{ color: '#E53E3E', fontSize: 16, fontFamily: 'Inter_700Bold' }}>Rs.{billTotal}</Text>
              </View>

              <View style={st.billDivider} />
              <Text style={[st.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 8 }]}>Payment Method</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setBillPayment('cash')} style={[st.billPayBtn, billPayment === 'cash' && st.billPayBtnActive]}>
                  <Text style={[st.billPayBtnText, billPayment === 'cash' && { color: '#fff' }]}>Cash</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setBillPayment('online')} style={[st.billPayBtn, billPayment === 'online' && st.billPayBtnActive]}>
                  <Text style={[st.billPayBtnText, billPayment === 'online' && { color: '#fff' }]}>Online</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setBillPayment('split')} style={[st.billPayBtn, billPayment === 'split' && st.billPayBtnActive]}>
                  <Text style={[st.billPayBtnText, billPayment === 'split' && { color: '#fff' }]}>Split</Text>
                </TouchableOpacity>
              </View>

              {billPayment === 'cash' && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[st.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6 }]}>Cash Given by Customer</Text>
                  <TextInput
                    value={billCashGiven}
                    onChangeText={setBillCashGiven}
                    keyboardType="numeric"
                    placeholder="Enter amount..."
                    placeholderTextColor="#999"
                    style={st.billCashInput}
                  />
                  {billCashGiven && Number(billCashGiven) >= billTotal && (
                    <View style={st.billChangeRow}>
                      <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Change to Return</Text>
                      <Text style={{ color: '#16A34A', fontSize: 16, fontFamily: 'Inter_700Bold' }}>Rs.{Number(billCashGiven) - billTotal}</Text>
                    </View>
                  )}
                  {billCashGiven && Number(billCashGiven) < billTotal && (
                    <Text style={{ color: '#EF4444', fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 6 }}>
                      Insufficient (need Rs.{billTotal - Number(billCashGiven)} more)
                    </Text>
                  )}
                </View>
              )}

              {billPayment === 'online' && (
                <View style={st.billChangeRow}>
                  <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Paid Online</Text>
                  <Text style={{ color: '#16A34A', fontSize: 16, fontFamily: 'Inter_700Bold' }}>Rs.{billTotal}</Text>
                </View>
              )}

              {billPayment === 'split' && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[st.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6 }]}>Cash Amount</Text>
                  <TextInput
                    value={billSplitCash}
                    onChangeText={(v) => {
                      setBillSplitCash(v);
                      const cash = Number(v) || 0;
                      setBillSplitOnline(cash <= billTotal ? String(billTotal - cash) : '0');
                    }}
                    keyboardType="numeric"
                    placeholder="Cash amount..."
                    placeholderTextColor="#999"
                    style={st.billCashInput}
                  />
                  <Text style={[st.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6, marginTop: 10 }]}>Online Amount</Text>
                  <TextInput
                    value={billSplitOnline}
                    onChangeText={(v) => {
                      setBillSplitOnline(v);
                      const online = Number(v) || 0;
                      setBillSplitCash(online <= billTotal ? String(billTotal - online) : '0');
                    }}
                    keyboardType="numeric"
                    placeholder="Online amount..."
                    placeholderTextColor="#999"
                    style={st.billCashInput}
                  />
                  {(Number(billSplitCash) || 0) + (Number(billSplitOnline) || 0) === billTotal && billSplitCash !== '' && (
                    <View style={[st.billChangeRow, { marginTop: 10 }]}>
                      <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Cash: Rs.{billSplitCash} + Online: Rs.{billSplitOnline}</Text>
                      <Text style={{ color: '#16A34A', fontSize: 13, fontFamily: 'Inter_700Bold' }}>Matched</Text>
                    </View>
                  )}
                  <Text style={[st.billInfo, { fontFamily: 'Inter_700Bold', marginTop: 10, marginBottom: 6 }]}>Cash Given by Customer</Text>
                  <TextInput
                    value={billCashGiven}
                    onChangeText={setBillCashGiven}
                    keyboardType="numeric"
                    placeholder="Enter cash given..."
                    placeholderTextColor="#999"
                    style={st.billCashInput}
                  />
                  {billCashGiven && Number(billCashGiven) >= (Number(billSplitCash) || 0) && (
                    <View style={st.billChangeRow}>
                      <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Change to Return</Text>
                      <Text style={{ color: '#16A34A', fontSize: 16, fontFamily: 'Inter_700Bold' }}>Rs.{Number(billCashGiven) - (Number(billSplitCash) || 0)}</Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setBillOrder(null)} style={[st.billActionBtn, { backgroundColor: '#F0F0F0' }]}>
                <Text style={[st.billActionBtnText, { color: '#1A1A1A' }]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  const payMethod = billPayment === 'split'
                    ? `split:cash=${billSplitCash},online=${billSplitOnline}`
                    : billPayment;
                  for (const o of billTableOrders) {
                    await supabase.from('orders').update({
                      order_status: 'delivered',
                      payment_method: payMethod,
                      payment_status: 'paid',
                    }).eq('id', o.id);
                  }
                  if (billOrder.table_id) {
                    await supabase.from('restaurant_tables').update({ status: 'available' }).eq('id', billOrder.table_id);
                  }
                  Alert.alert('Bill Settled', `${billTableOrders.length} order(s) settled — Table ${tbl?.table_number ?? ''} is now free.`);
                  setBillOrder(null);
                  setBillTableOrders([]);
                  fetchAll();
                }}
                style={[st.billActionBtn, { backgroundColor: '#16A34A' }]}
              >
                <Text style={st.billActionBtnText}>Settle & Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        );
      })()}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 18 },
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

  resetBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  resetBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  // Bill
  billBtn: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  billBtnText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  billOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  billModal: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%' as any, maxHeight: '85%' as any },
  billDivider: { height: 1, backgroundColor: '#EEEEEE', marginVertical: 10 },
  billInfo: { color: '#666', fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 2 },
  billItemText: { color: '#1A1A1A', fontSize: 12, fontFamily: 'Inter_400Regular' },
  billPayBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#EEEEEE', alignItems: 'center' },
  billPayBtnActive: { backgroundColor: '#E53E3E', borderColor: '#E53E3E' },
  billPayBtnText: { color: '#1A1A1A', fontSize: 13, fontFamily: 'Inter_700Bold' },
  billCashInput: { backgroundColor: '#F8F9FA', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1A1A1A', borderWidth: 1, borderColor: '#EEEEEE', fontFamily: 'Inter_400Regular' },
  billChangeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 },
  billActionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  billActionBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
});
