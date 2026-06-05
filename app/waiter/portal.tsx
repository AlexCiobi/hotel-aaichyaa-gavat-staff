import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, FlatList,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/colors';
import { playWaiterNotification, unloadSounds } from '../../lib/sounds';
import type { RestaurantTable, MenuItem, CartItem, OrderRecord } from '../../lib/types';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'thali', label: 'Thali' },
  { key: 'starters', label: 'Starters' },
  { key: 'main_course', label: 'Main' },
  { key: 'breads', label: 'Breads' },
  { key: 'rice', label: 'Rice' },
  { key: 'beverages', label: 'Drinks' },
  { key: 'snacks', label: 'Snacks' },
];

function statusBadge(s: string) {
  const map: Record<string, { bg: string; text: string }> = {
    placed: { bg: 'rgba(59,130,246,0.1)', text: COLORS.blue },
    confirmed: { bg: 'rgba(168,85,247,0.1)', text: COLORS.purple },
    preparing: { bg: 'rgba(234,179,8,0.1)', text: '#B8860B' },
    ready: { bg: 'rgba(34,197,94,0.1)', text: '#16A34A' },
  };
  return map[s] ?? { bg: '#F5F5F5', text: COLORS.textMuted };
}

type TabView = 'tables' | 'menu' | 'orders';

export default function WaiterPortal() {
  const [waiterName, setWaiterName] = useState('Waiter');
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<TabView>('tables');
  const [showCart, setShowCart] = useState(false);

  const fetchAll = useCallback(async () => {
    const [{ data: t }, { data: m }, { data: o }] = await Promise.all([
      supabase.from('restaurant_tables').select('*').order('table_number'),
      supabase.from('menu_items').select('*').eq('is_available', true).order('category'),
      supabase.from('orders').select('*')
        .in('order_status', ['placed', 'confirmed', 'preparing', 'ready'])
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setTables(t ?? []);
    setMenuItems(m ?? []);
    setOrders(o ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('staff_waiter');
      if (!raw) { router.replace('/waiter/login'); return; }
      const data = JSON.parse(raw);
      setWaiterName(data.name ?? 'Waiter');
    })();
    fetchAll();
  }, [fetchAll]);

  // Real-time with sound when order becomes ready
  useEffect(() => {
    const ch = supabase
      .channel('waiter-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload: any) => {
        if (payload.new?.order_status === 'ready' && payload.old?.order_status !== 'ready') {
          playWaiterNotification();
        }
        fetchAll();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); unloadSounds(); };
  }, [fetchAll]);

  const filteredMenu = menuItems.filter(i => {
    if (category !== 'all' && i.category !== category) return false;
    if (search && !i.name_en.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const ex = prev.find(c => c.menuItem.id === item.id);
      if (ex) return prev.map(c => c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => c.menuItem.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0));
  };

  const cartTotal = cart.reduce((s, c) => s + c.menuItem.price * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const submitOrder = async () => {
    if (!selectedTable || cart.length === 0) return;
    setSubmitting(true);
    const orderData = {
      customer_name: `Table ${selectedTable.table_number} (${waiterName})`,
      customer_phone: '+910000000000',
      whatsapp_number: '+910000000000',
      order_type: 'dine-in',
      table_id: selectedTable.id,
      items: cart.map(c => ({ id: c.menuItem.id, name: c.menuItem.name_en, qty: c.quantity, price: c.menuItem.price })),
      subtotal: cartTotal,
      total: cartTotal,
      payment_method: 'cod',
      payment_status: 'pending',
      order_status: 'placed',
      special_instructions: instructions || null,
    };
    const { error } = await supabase.from('orders').insert(orderData);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await supabase.from('restaurant_tables').update({ status: 'occupied' }).eq('id', selectedTable.id);
      Alert.alert('Order Sent!', `Order for Table ${selectedTable.table_number} sent to kitchen.`);
      setCart([]);
      setInstructions('');
      setShowCart(false);
      setTab('orders');
      fetchAll();
    }
    setSubmitting(false);
  };

  const freeTable = (table: RestaurantTable) => {
    Alert.alert(
      'Free Table',
      `Mark Table ${table.table_number} as available?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Free Table',
          onPress: async () => {
            await supabase.from('restaurant_tables').update({ status: 'available' }).eq('id', table.id);
            fetchAll();
          },
        },
      ]
    );
  };

  const logout = async () => {
    await AsyncStorage.removeItem('staff_waiter');
    router.replace('/waiter/login');
  };

  const tableForId = (id: string | null) => tables.find(t => t.id === id);

  // ---- RENDER ----
  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.headerDot} />
          <View>
            <Text style={s.headerTitle}>Waiter Portal</Text>
            <Text style={s.headerSub}>{waiterName}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={s.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['tables', 'menu', 'orders'] as TabView[]).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'tables' ? 'Tables' : t === 'menu' ? `Menu${cartCount > 0 ? ` (${cartCount})` : ''}` : 'Orders'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ====== TABLES ====== */}
      {tab === 'tables' && (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.sectionTitle}>Select a Table</Text>
          <View style={s.tableGrid}>
            {tables.map(table => {
              const sel = selectedTable?.id === table.id;
              const occ = table.status === 'occupied';
              const res = table.status === 'reserved';
              return (
                <TouchableOpacity key={table.id}
                  onPress={() => { setSelectedTable(table); setTab('menu'); }}
                  onLongPress={() => occ ? freeTable(table) : undefined}
                  delayLongPress={500}
                  style={[s.tableCard, sel && s.tableCardSel, occ && s.tableCardOcc, res && s.tableCardRes]}>
                  <Text style={s.tableNum}>{table.table_number}</Text>
                  <Text style={s.tableSeats}>{table.capacity} seats</Text>
                  <Text style={[s.tableBadge, occ && { color: COLORS.orange }, res && { color: COLORS.purple }]}>
                    {occ ? 'Busy' : res ? 'Rsv' : 'Free'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={s.legend}>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: COLORS.green }]} /><Text style={s.legendText}>Available</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: COLORS.orange }]} /><Text style={s.legendText}>Occupied</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: COLORS.purple }]} /><Text style={s.legendText}>Reserved</Text></View>
          </View>
          <Text style={{ color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 12, textAlign: 'center' }}>
            Long-press an occupied table to free it
          </Text>
        </ScrollView>
      )}

      {/* ====== MENU ====== */}
      {tab === 'menu' && (
        <View style={{ flex: 1 }}>
          {selectedTable ? (
            <View style={s.tableBanner}>
              <Text style={s.tableBannerText}>Table {selectedTable.table_number}</Text>
              <Text style={s.tableBannerSub}>{selectedTable.capacity} seats · {selectedTable.zone}</Text>
              <TouchableOpacity onPress={() => { setSelectedTable(null); setTab('tables'); }} style={s.tableBannerClose}>
                <Text style={{ color: COLORS.textMuted, fontSize: 18 }}>×</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.noTable}>
              <Text style={s.noTableText}>Select a table first</Text>
              <TouchableOpacity onPress={() => setTab('tables')}>
                <Text style={s.noTableLink}>Go to Tables</Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedTable && (
            <>
              {/* Search */}
              <View style={s.searchWrap}>
                <TextInput value={search} onChangeText={setSearch} placeholder="Search menu..."
                  placeholderTextColor={COLORS.textDim} style={s.searchInput} />
              </View>

              {/* Categories */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity key={cat.key} onPress={() => setCategory(cat.key)}
                    style={[s.catPill, category === cat.key && s.catPillActive]}>
                    <Text style={[s.catPillText, category === cat.key && s.catPillTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Items */}
              <FlatList
                data={filteredMenu}
                keyExtractor={i => i.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: cart.length > 0 ? 180 : 100 }}
                renderItem={({ item }) => {
                  const inCart = cart.find(c => c.menuItem.id === item.id);
                  return (
                    <View style={s.menuRow}>
                      <View style={[s.vegDot, { backgroundColor: item.is_veg ? COLORS.green : COLORS.red }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.menuName}>{item.name_en}</Text>
                        <Text style={s.menuNameMr}>{item.name_mr}</Text>
                      </View>
                      <Text style={s.menuPrice}>Rs.{item.price}</Text>
                      {inCart ? (
                        <View style={s.qtyRow}>
                          <TouchableOpacity onPress={() => updateQty(item.id, -1)} style={s.qtyBtn}>
                            <Text style={s.qtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={s.qtyNum}>{inCart.quantity}</Text>
                          <TouchableOpacity onPress={() => updateQty(item.id, 1)} style={[s.qtyBtn, s.qtyBtnAdd]}>
                            <Text style={[s.qtyBtnText, { color: '#fff' }]}>+</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => addToCart(item)} style={s.addBtn}>
                          <Text style={s.addBtnText}>ADD</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
              />
            </>
          )}

          {/* Cart bar */}
          {cart.length > 0 && selectedTable && (
            <View style={s.cartBar}>
              {showCart && (
                <View style={s.cartExpanded}>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {cart.map(c => (
                      <View key={c.menuItem.id} style={s.cartRow}>
                        <Text style={s.cartItemName} numberOfLines={1}>{c.menuItem.name_en}</Text>
                        <View style={s.cartQtyRow}>
                          <TouchableOpacity onPress={() => updateQty(c.menuItem.id, -1)} style={s.cartQtyBtn}>
                            <Text style={s.cartQtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={s.cartQtyNum}>{c.quantity}</Text>
                          <TouchableOpacity onPress={() => updateQty(c.menuItem.id, 1)} style={s.cartQtyBtn}>
                            <Text style={s.cartQtyBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={s.cartItemPrice}>Rs.{c.menuItem.price * c.quantity}</Text>
                      </View>
                    ))}
                  </ScrollView>
                  <TextInput value={instructions} onChangeText={setInstructions}
                    placeholder="Special instructions..." placeholderTextColor={COLORS.textDim}
                    style={s.instrInput} />
                </View>
              )}
              <View style={s.cartActions}>
                <TouchableOpacity onPress={() => setShowCart(!showCart)} style={s.cartToggle}>
                  <Text style={s.cartToggleText}>{showCart ? 'Hide' : 'View'} Cart · {cartCount} items · Rs.{cartTotal}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitOrder} disabled={submitting} style={[s.sendBtn, submitting && { opacity: 0.5 }]}>
                  {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendBtnText}>Send to Kitchen</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ====== ORDERS ====== */}
      {tab === 'orders' && (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.ordersHeader}>
            <Text style={s.sectionTitle}>Active Orders</Text>
            <TouchableOpacity onPress={fetchAll}>
              <Text style={s.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {orders.length === 0 && <Text style={s.emptyText}>No active orders</Text>}
          {orders.map(order => {
            const t = tableForId(order.table_id);
            const badge = statusBadge(order.order_status);
            return (
              <View key={order.id} style={s.orderCard}>
                <View style={s.orderTop}>
                  <View>
                    <Text style={s.orderNum}>{order.order_number}</Text>
                    {t && <Text style={s.orderTable}>Table {t.table_number}</Text>}
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[s.statusText, { color: badge.text }]}>{order.order_status.toUpperCase()}</Text>
                  </View>
                </View>
                {Array.isArray(order.items) && order.items.map((item, i) => (
                  <View key={i} style={s.orderItem}>
                    <Text style={s.orderItemText}>{item.name} × {item.qty}</Text>
                    <Text style={s.orderItemPrice}>Rs.{item.price * item.qty}</Text>
                  </View>
                ))}
                {order.special_instructions && (
                  <View style={s.orderNote}>
                    <Text style={s.orderNoteText}>Note: {order.special_instructions}</Text>
                  </View>
                )}
                <View style={s.orderBottom}>
                  <Text style={s.orderTime}>
                    {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={s.orderTotal}>Rs.{order.total || order.subtotal}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.crimson },
  headerTitle: { color: COLORS.text, fontSize: 15, fontFamily: 'Inter_700Bold' },
  headerSub: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  logoutText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.crimson },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  tabTextActive: { color: COLORS.crimson },

  content: { padding: 16, paddingBottom: 100 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 16 },

  // Tables
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tableCard: { width: '23%' as any, aspectRatio: 1, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tableCardSel: { borderColor: COLORS.crimson, backgroundColor: COLORS.crimsonLight },
  tableCardOcc: { borderColor: 'rgba(249,115,22,0.4)', backgroundColor: 'rgba(249,115,22,0.06)' },
  tableCardRes: { borderColor: 'rgba(168,85,247,0.4)', backgroundColor: 'rgba(168,85,247,0.06)' },
  tableNum: { color: COLORS.text, fontSize: 18, fontFamily: 'Inter_700Bold' },
  tableSeats: { color: COLORS.textMuted, fontSize: 9, fontFamily: 'Inter_400Regular' },
  tableBadge: { color: COLORS.green, fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  legend: { flexDirection: 'row', gap: 16, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { color: COLORS.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular' },

  // Menu
  tableBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.crimsonLight, borderBottomWidth: 1, borderBottomColor: 'rgba(192,39,45,0.12)' },
  tableBannerText: { color: COLORS.crimson, fontFamily: 'Inter_700Bold', fontSize: 14 },
  tableBannerSub: { color: COLORS.textMuted, fontSize: 11, marginLeft: 8, fontFamily: 'Inter_400Regular' },
  tableBannerClose: { marginLeft: 'auto', padding: 4 },
  noTable: { alignItems: 'center', paddingVertical: 60 },
  noTableText: { color: COLORS.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular' },
  noTableLink: { color: COLORS.crimson, fontSize: 14, fontFamily: 'Inter_700Bold', marginTop: 8 },

  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  searchInput: { backgroundColor: COLORS.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.border, fontFamily: 'Inter_400Regular' },

  catRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  catPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: COLORS.inputBg },
  catPillActive: { backgroundColor: COLORS.crimson },
  catPillText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  catPillTextActive: { color: '#fff' },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  vegDot: { width: 8, height: 8, borderRadius: 2 },
  menuName: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  menuNameMr: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  menuPrice: { color: COLORS.crimson, fontSize: 14, fontFamily: 'Inter_700Bold', marginRight: 8 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: COLORS.crimsonLight, borderWidth: 1, borderColor: 'rgba(192,39,45,0.15)' },
  addBtnText: { color: COLORS.crimson, fontSize: 11, fontFamily: 'Inter_700Bold' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.inputBg, alignItems: 'center', justifyContent: 'center' },
  qtyBtnAdd: { backgroundColor: COLORS.crimson },
  qtyBtnText: { color: COLORS.text, fontSize: 16, fontFamily: 'Inter_700Bold' },
  qtyNum: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_700Bold', minWidth: 16, textAlign: 'center' },

  // Cart bar
  cartBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  cartExpanded: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cartRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  cartItemName: { flex: 1, color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular' },
  cartQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartQtyBtn: { width: 22, height: 22, borderRadius: 6, backgroundColor: COLORS.inputBg, alignItems: 'center', justifyContent: 'center' },
  cartQtyBtnText: { color: COLORS.text, fontSize: 12, fontFamily: 'Inter_700Bold' },
  cartQtyNum: { color: COLORS.text, fontSize: 12, fontFamily: 'Inter_700Bold', width: 14, textAlign: 'center' },
  cartItemPrice: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold', width: 56, textAlign: 'right' },
  instrInput: { backgroundColor: COLORS.inputBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, fontSize: 12, marginTop: 8, borderWidth: 1, borderColor: COLORS.border, fontFamily: 'Inter_400Regular' },
  cartActions: { flexDirection: 'row', padding: 12, gap: 10 },
  cartToggle: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center' },
  cartToggleText: { color: COLORS.text, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  sendBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.crimson, alignItems: 'center' },
  sendBtnText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold' },

  // Orders
  ordersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  refreshText: { color: COLORS.crimson, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', paddingVertical: 40, fontSize: 14, fontFamily: 'Inter_400Regular' },
  orderCard: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 10 },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  orderNum: { color: COLORS.crimson, fontFamily: 'Inter_700Bold', fontSize: 14 },
  orderTable: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  orderItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  orderItemText: { color: COLORS.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderItemPrice: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  orderNote: { marginTop: 6, backgroundColor: 'rgba(234,179,8,0.06)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(234,179,8,0.15)' },
  orderNoteText: { color: 'rgba(180,140,8,0.8)', fontSize: 10, fontFamily: 'Inter_400Regular' },
  orderBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  orderTime: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  orderTotal: { color: COLORS.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
});
