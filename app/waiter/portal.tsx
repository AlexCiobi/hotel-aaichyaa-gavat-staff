import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, FlatList, Image, Animated,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/colors';
import { playWaiterNotification, playBillNotification, unloadSounds } from '../../lib/sounds';
import type { RestaurantTable, MenuItem, CartItem, OrderRecord } from '../../lib/types';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'VEG', label: 'Veg' },
  { key: 'NON_VEG_PLATTER', label: 'Non-Veg' },
  { key: 'CHICKEN_HANDI', label: 'Chicken Handi' },
  { key: 'MUTTON_HANDI', label: 'Mutton Handi' },
  { key: 'MUTTON_PLATE', label: 'Mutton Plate' },
  { key: 'EGG', label: 'Egg' },
  { key: 'RICE', label: 'Rice' },
  { key: 'BREAD', label: 'Bread' },
  { key: 'OTHERS', label: 'Others' },
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

interface BillData {
  order: OrderRecord;
  tableName: string | null;
  paymentMethod: 'cash' | 'online';
  cashGiven: number;
}


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
  const [billOrder, setBillOrder] = useState<OrderRecord | null>(null);
  const [billTableOrders, setBillTableOrders] = useState<OrderRecord[]>([]);
  const [billPayment, setBillPayment] = useState<'cash' | 'online' | 'split'>('cash');
  const [billCashGiven, setBillCashGiven] = useState('');
  const [billSplitCash, setBillSplitCash] = useState('');
  const [billSplitOnline, setBillSplitOnline] = useState('');
  const [editOrder, setEditOrder] = useState<OrderRecord | null>(null);
  const [editItems, setEditItems] = useState<{ id: string; name: string; qty: number; price: number }[]>([]);
  const [editSearch, setEditSearch] = useState('');
  const [editShowMenu, setEditShowMenu] = useState(false);
  const [editCategory, setEditCategory] = useState('all');


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

  // Notification popup state
  const [notif, setNotif] = useState<string | null>(null);
  const notifAnim = useRef(new Animated.Value(-100)).current;
  const notifTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showNotif = (msg: string) => {
    setNotif(msg);
    notifAnim.setValue(-100);
    Animated.spring(notifAnim, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => {
      Animated.timing(notifAnim, { toValue: -100, duration: 300, useNativeDriver: true }).start(() => setNotif(null));
    }, 4000);
  };

  // Track delivered order IDs to avoid re-triggering bill on refresh
  const deliveredBillShown = useRef<Set<string>>(new Set());

  // Real-time with sound when order becomes ready + auto-bill on delivered
  useEffect(() => {
    const ch = supabase
      .channel('waiter-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload: any) => {
        if (payload.new?.order_status === 'ready' && payload.old?.order_status !== 'ready') {
          const orderNum = payload.new?.order_number ?? '';
          playWaiterNotification(orderNum);
          showNotif(`✅ Order ${orderNum} is READY — Pick up from kitchen!`);
        }
        // Auto-open bill when kitchen marks order as delivered
        if (payload.new?.order_status === 'delivered' && payload.old?.order_status !== 'delivered') {
          const orderId = payload.new?.id;
          if (orderId && !deliveredBillShown.current.has(orderId)) {
            deliveredBillShown.current.add(orderId);
            // Fetch fresh data first, then open bill
            const [{ data: freshOrders }] = await Promise.all([
              supabase.from('orders').select('*')
                .in('order_status', ['placed', 'confirmed', 'preparing', 'ready', 'delivered'])
                .order('created_at', { ascending: false }),
            ]);
            const allActive = freshOrders ?? [];
            setOrders(allActive);
            const deliveredOrder = allActive.find((o: OrderRecord) => o.id === orderId);
            if (deliveredOrder) {
              const tableOrders = deliveredOrder.table_id
                ? allActive.filter((o: OrderRecord) => o.table_id === deliveredOrder.table_id && o.order_status !== 'cancelled')
                : [deliveredOrder];
              setBillTableOrders(tableOrders);
              setBillOrder(deliveredOrder);
              setBillCashGiven('');
              setBillSplitCash('');
              setBillSplitOnline('');
              setBillPayment('cash');
              playBillNotification(deliveredOrder.order_number);
              showNotif(`🧾 Bill generated — Table ${deliveredOrder.table_id ? '' : 'Takeaway'}`);
            }
            return; // skip fetchAll since we already fetched
          }
        }
        fetchAll();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); unloadSounds(); };
  }, [fetchAll]);

  const filteredMenu = menuItems.filter(i => {
    if (category !== 'all' && i.category !== category) return false;
    if (search && !i.name_en.toLowerCase().includes(search.toLowerCase()) && !(i.name_mr && i.name_mr.includes(search))) return false;
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
      items: cart.map(c => ({ id: c.menuItem.id, name: c.menuItem.name_en, name_mr: c.menuItem.name_mr, qty: c.quantity, price: c.menuItem.price })),
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

  const openTableBill = (order: OrderRecord) => {
    // Find ALL non-cancelled orders for this table
    const tableOrders = order.table_id
      ? orders.filter(o => o.table_id === order.table_id && o.order_status !== 'cancelled')
      : [order];
    setBillTableOrders(tableOrders);
    setBillOrder(order);
    setBillCashGiven('');
    setBillSplitCash('');
    setBillSplitOnline('');
    setBillPayment('cash');
  };

  const cancelOrder = (order: OrderRecord) => {
    Alert.alert(
      'Cancel Order',
      `Cancel order ${order.order_number}? This cannot be undone.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('orders').update({ order_status: 'cancelled' }).eq('id', order.id);
            if (order.table_id) {
              const otherOrders = orders.filter(o => o.id !== order.id && o.table_id === order.table_id);
              if (otherOrders.length === 0) {
                await supabase.from('restaurant_tables').update({ status: 'available' }).eq('id', order.table_id);
              }
            }
            Alert.alert('Cancelled', `Order ${order.order_number} has been cancelled.`);
            fetchAll();
          },
        },
      ]
    );
  };

  const openEditOrder = (order: OrderRecord) => {
    setEditOrder(order);
    setEditItems(Array.isArray(order.items) ? order.items.map(i => ({ ...i })) : []);
    setEditSearch('');
    setEditShowMenu(false);
    setEditCategory('all');
  };

  const addItemToEdit = (menuItem: MenuItem) => {
    setEditItems(prev => {
      const existing = prev.find(i => i.id === menuItem.id);
      if (existing) return prev.map(i => i.id === menuItem.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id: menuItem.id, name: menuItem.name_en, qty: 1, price: menuItem.price }];
    });
  };

  const editMenuFiltered = menuItems.filter(i => {
    if (editCategory !== 'all' && i.category !== editCategory) return false;
    if (editSearch && !i.name_en.toLowerCase().includes(editSearch.toLowerCase()) && !(i.name_mr && i.name_mr.includes(editSearch))) return false;
    return true;
  });

  const updateEditQty = (idx: number, delta: number) => {
    setEditItems(prev => {
      const updated = prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item);
      return updated.filter(i => i.qty > 0);
    });
  };

  const saveEditOrder = async () => {
    if (!editOrder) return;
    if (editItems.length === 0) {
      Alert.alert('Empty Order', 'Cannot save an order with no items. Cancel the order instead.');
      return;
    }
    const newSubtotal = editItems.reduce((s, i) => s + i.price * i.qty, 0);
    const { error } = await supabase.from('orders').update({
      items: editItems,
      subtotal: newSubtotal,
      total: newSubtotal,
    }).eq('id', editOrder.id);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Updated', `Order ${editOrder.order_number} has been modified.`);
      setEditOrder(null);
      fetchAll();
    }
  };

  // ---- RENDER ----
  return (
    <SafeAreaView style={s.container}>
      {/* Notification popup */}
      {notif && (
        <Animated.View style={[s.notifBanner, { transform: [{ translateY: notifAnim }] }]}>
          <Text style={s.notifText}>{notif}</Text>
          <TouchableOpacity onPress={() => {
            Animated.timing(notifAnim, { toValue: -100, duration: 200, useNativeDriver: true }).start(() => setNotif(null));
          }}>
            <Text style={s.notifDismiss}>✕</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Image source={require('../../assets/logo.png')} style={s.headerDot} />
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
          {/* Main Section */}
          <Text style={s.sectionTitle}>Main Section</Text>
          <View style={s.tableGrid}>
            {tables.filter(t => t.zone === 'main').map(table => {
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

          {/* Family Section */}
          <Text style={[s.sectionTitle, { marginTop: 20 }]}>Family Section</Text>
          <View style={s.tableGrid}>
            {tables.filter(t => t.zone === 'family').map(table => {
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
              {/* Items */}
              <FlatList
                data={filteredMenu}
                keyExtractor={i => i.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: cart.length > 0 ? 180 : 100 }}
                ListHeaderComponent={
                  <>
                    <View style={[s.searchWrap, { paddingHorizontal: 0 }]}>
                      <TextInput value={search} onChangeText={setSearch} placeholder="Search menu..."
                        placeholderTextColor={COLORS.textDim} style={s.searchInput} />
                    </View>
                    <View style={[s.catRow, { paddingHorizontal: 0 }]}>
                      {CATEGORIES.map(cat => (
                        <TouchableOpacity key={cat.key} onPress={() => setCategory(cat.key)}
                          style={[s.catPill, category === cat.key && s.catPillActive]}>
                          <Text style={[s.catPillText, category === cat.key && s.catPillTextActive]}>{cat.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                }
                renderItem={({ item }) => {
                  const inCart = cart.find(c => c.menuItem.id === item.id);
                  return (
                    <View style={s.menuRow}>
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={s.menuImg} />
                      ) : (
                        <View style={[s.menuImgPlaceholder, { backgroundColor: item.is_veg ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }]}>
                          <Text style={{ fontSize: 16 }}>{item.is_veg ? '🥬' : '🍗'}</Text>
                        </View>
                      )}
                      <View style={[s.vegDot, { backgroundColor: item.is_veg ? COLORS.green : COLORS.red }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.menuName}>{item.name_mr}</Text>
                        <Text style={s.menuNameEn}>{item.name_en}</Text>
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
                <TouchableOpacity onPress={() => openTableBill(order)} style={s.billBtn}>
                  <Text style={s.billBtnText}>Generate Bill</Text>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {order.order_status !== 'ready' && (
                    <TouchableOpacity onPress={() => openEditOrder(order)} style={[s.orderActionBtn, { backgroundColor: 'rgba(59,130,246,0.1)' }]}>
                      <Text style={[s.orderActionBtnText, { color: '#2563EB' }]}>Modify</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => cancelOrder(order)} style={[s.orderActionBtn, { backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                    <Text style={[s.orderActionBtnText, { color: '#EF4444' }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      {/* ====== EDIT ORDER MODAL ====== */}
      {editOrder && (
        <View style={s.billOverlay}>
          <View style={[s.billModal, { maxHeight: '90%' }]}>
            <Text style={s.billTitle}>Modify Order</Text>
            <Text style={[s.billInfo, { textAlign: 'center', marginBottom: 8 }]}>{editOrder.order_number}</Text>
            <View style={s.billDivider} />
            <ScrollView style={{ maxHeight: editShowMenu ? 150 : 250 }}>
              {editItems.map((item, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}>
                  <Text style={{ flex: 1, color: COLORS.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginRight: 10 }}>Rs.{item.price}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity onPress={() => updateEditQty(idx, -1)} style={s.qtyBtn}>
                      <Text style={s.qtyBtnText}>-</Text>
                    </TouchableOpacity>
                    <Text style={s.qtyNum}>{item.qty}</Text>
                    <TouchableOpacity onPress={() => updateEditQty(idx, 1)} style={[s.qtyBtn, s.qtyBtnAdd]}>
                      <Text style={[s.qtyBtnText, { color: '#fff' }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Add Items from Menu */}
            <TouchableOpacity
              onPress={() => setEditShowMenu(!editShowMenu)}
              style={{ backgroundColor: COLORS.crimson + '10', borderRadius: 10, padding: 10, marginTop: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
            >
              <Text style={{ color: COLORS.crimson, fontFamily: 'Inter_700Bold', fontSize: 13 }}>
                {editShowMenu ? 'Hide Menu' : '+ Add Items from Menu'}
              </Text>
            </TouchableOpacity>

            {editShowMenu && (
              <View style={{ marginTop: 8 }}>
                <TextInput
                  value={editSearch}
                  onChangeText={setEditSearch}
                  placeholder="Search menu..."
                  placeholderTextColor={COLORS.textDim}
                  style={{ backgroundColor: COLORS.inputBg, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'Inter_400Regular', color: COLORS.text, marginBottom: 6 }}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {CATEGORIES.map(cat => (
                      <TouchableOpacity
                        key={cat.key}
                        onPress={() => setEditCategory(cat.key)}
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: editCategory === cat.key ? COLORS.crimson : COLORS.inputBg }}
                      >
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: editCategory === cat.key ? '#fff' : COLORS.text }}>{cat.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <ScrollView style={{ maxHeight: 220 }}>
                  {editMenuFiltered.map(mi => {
                    const inOrder = editItems.find(i => i.id === mi.id);
                    return (
                      <TouchableOpacity
                        key={mi.id}
                        onPress={() => addItemToEdit(mi)}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mi.is_veg ? '#16A34A' : '#EF4444', marginRight: 8 }} />
                        <Text style={{ flex: 1, color: COLORS.text, fontSize: 13, fontFamily: 'Inter_400Regular' }}>{mi.name_en}</Text>
                        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginRight: 8 }}>Rs.{mi.price}</Text>
                        {inOrder ? (
                          <View style={{ backgroundColor: COLORS.crimson, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' }}>{inOrder.qty}</Text>
                          </View>
                        ) : (
                          <View style={{ backgroundColor: COLORS.crimson, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' }}>+</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={s.billDivider} />
            <View style={s.billTotalRow}>
              <Text style={s.billTotalLabel}>New Total</Text>
              <Text style={[s.billTotalValue, { color: COLORS.crimson }]}>Rs.{editItems.reduce((sum, i) => sum + i.price * i.qty, 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setEditOrder(null)} style={[s.billActionBtn, { backgroundColor: COLORS.inputBg }]}>
                <Text style={[s.billActionBtnText, { color: COLORS.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEditOrder} style={[s.billActionBtn, { backgroundColor: COLORS.blue }]}>
                <Text style={s.billActionBtnText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {/* ====== BILL MODAL (consolidated per table) ====== */}
      {billOrder && (() => {
        // Separate first order items from add-on orders
        const sorted = [...billTableOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const firstOrder = sorted[0];
        const addOnOrders = sorted.slice(1);

        // First order items (merged)
        const mainItems: { name: string; name_mr?: string; qty: number; price: number }[] = [];
        if (firstOrder && Array.isArray(firstOrder.items)) {
          firstOrder.items.forEach((item: any) => {
            const existing = mainItems.find(a => a.name === item.name && a.price === item.price);
            if (existing) { existing.qty += item.qty; }
            else { mainItems.push({ name: item.name, name_mr: item.name_mr, qty: item.qty, price: item.price }); }
          });
        }

        // Add-on items (merged across all subsequent orders)
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
        <View style={s.billOverlay}>
          <View style={s.billModal}>
            <ScrollView>
              <View style={s.billHeader}>
                <Image source={require('../../assets/logo.png')} style={{ width: 50, height: 50, borderRadius: 25, alignSelf: 'center' }} />
                <Text style={s.billTitle}>Hotel Aaichyaa Gavat</Text>
                <Text style={s.billSubtitle}>हक्काची जागा</Text>
                <View style={s.billDivider} />
                {tbl && <Text style={s.billInfo}>Table: {tbl.table_number}</Text>}
                <Text style={s.billInfo}>Date: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                <Text style={s.billInfo}>Time: {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
                {billTableOrders.length > 1 && (
                  <Text style={[s.billInfo, { color: COLORS.crimson, fontFamily: 'Inter_600SemiBold', marginTop: 4 }]}>
                    {billTableOrders.length} orders combined
                  </Text>
                )}
                {billTableOrders.map(o => (
                  <Text key={o.id} style={[s.billInfo, { fontSize: 10, color: COLORS.textMuted }]}>{o.order_number}</Text>
                ))}
              </View>

              <View style={s.billDivider} />
              <View style={s.billItemsHeader}>
                <Text style={[s.billItemText, { flex: 1, fontFamily: 'Inter_700Bold' }]}>Item</Text>
                <Text style={[s.billItemText, { width: 30, textAlign: 'center', fontFamily: 'Inter_700Bold' }]}>Qty</Text>
                <Text style={[s.billItemText, { width: 60, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Price</Text>
                <Text style={[s.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Total</Text>
              </View>
              {mainItems.map((item, i) => (
                <View key={i} style={s.billItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.billItemText}>{item.name_mr || item.name}</Text>
                    {item.name_mr && <Text style={{ color: COLORS.textMuted, fontSize: 9, fontFamily: 'Inter_400Regular' }}>{item.name}</Text>}
                  </View>
                  <Text style={[s.billItemText, { width: 30, textAlign: 'center' }]}>{item.qty}</Text>
                  <Text style={[s.billItemText, { width: 60, textAlign: 'right' }]}>Rs.{item.price}</Text>
                  <Text style={[s.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Rs.{item.price * item.qty}</Text>
                </View>
              ))}

              {addOnItems.length > 0 && (
                <>
                  <View style={[s.billDivider, { marginVertical: 6 }]} />
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: COLORS.crimson, marginBottom: 6, textAlign: 'center' }}>— Extra Add-ons —</Text>
                  {addOnItems.map((item, i) => (
                    <View key={`addon-${i}`} style={s.billItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.billItemText}>{item.name_mr || item.name}</Text>
                        {item.name_mr && <Text style={{ color: COLORS.textMuted, fontSize: 9, fontFamily: 'Inter_400Regular' }}>{item.name}</Text>}
                      </View>
                      <Text style={[s.billItemText, { width: 30, textAlign: 'center' }]}>{item.qty}</Text>
                      <Text style={[s.billItemText, { width: 60, textAlign: 'right' }]}>Rs.{item.price}</Text>
                      <Text style={[s.billItemText, { width: 70, textAlign: 'right', fontFamily: 'Inter_700Bold' }]}>Rs.{item.price * item.qty}</Text>
                    </View>
                  ))}
                </>
              )}

              <View style={s.billDivider} />
              <View style={s.billTotalRow}>
                <Text style={[s.billTotalLabel, { fontFamily: 'Inter_700Bold', fontSize: 16 }]}>TOTAL</Text>
                <Text style={[s.billTotalValue, { fontFamily: 'Inter_700Bold', fontSize: 16, color: COLORS.crimson }]}>Rs.{billTotal}</Text>
              </View>

              <View style={s.billDivider} />
              <Text style={[s.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 8 }]}>Payment Method</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setBillPayment('cash')} style={[s.billPayBtn, billPayment === 'cash' && s.billPayBtnActive]}>
                  <Text style={[s.billPayBtnText, billPayment === 'cash' && { color: '#fff' }]}>Cash</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setBillPayment('online')} style={[s.billPayBtn, billPayment === 'online' && s.billPayBtnActive]}>
                  <Text style={[s.billPayBtnText, billPayment === 'online' && { color: '#fff' }]}>Online</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setBillPayment('split')} style={[s.billPayBtn, billPayment === 'split' && s.billPayBtnActive]}>
                  <Text style={[s.billPayBtnText, billPayment === 'split' && { color: '#fff' }]}>Split</Text>
                </TouchableOpacity>
              </View>

              {billPayment === 'cash' && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[s.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6 }]}>Cash Given by Customer</Text>
                  <TextInput
                    value={billCashGiven}
                    onChangeText={setBillCashGiven}
                    keyboardType="numeric"
                    placeholder="Enter amount..."
                    placeholderTextColor={COLORS.textDim}
                    style={s.billCashInput}
                  />
                  {billCashGiven && Number(billCashGiven) >= billTotal && (
                    <View style={s.billChangeRow}>
                      <Text style={s.billChangeLabel}>Change to Return</Text>
                      <Text style={s.billChangeValue}>Rs.{Number(billCashGiven) - billTotal}</Text>
                    </View>
                  )}
                  {billCashGiven && Number(billCashGiven) < billTotal && (
                    <Text style={{ color: COLORS.red, fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 6 }}>
                      Insufficient (need Rs.{billTotal - Number(billCashGiven)} more)
                    </Text>
                  )}
                </View>
              )}

              {billPayment === 'online' && (
                <View style={s.billChangeRow}>
                  <Text style={s.billChangeLabel}>Paid Online</Text>
                  <Text style={[s.billChangeValue, { color: COLORS.green }]}>Rs.{billTotal}</Text>
                </View>
              )}

              {billPayment === 'split' && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[s.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6 }]}>Cash Amount</Text>
                  <TextInput
                    value={billSplitCash}
                    onChangeText={(v) => {
                      setBillSplitCash(v);
                      const cash = Number(v) || 0;
                      setBillSplitOnline(cash <= billTotal ? String(billTotal - cash) : '0');
                    }}
                    keyboardType="numeric"
                    placeholder="Cash amount..."
                    placeholderTextColor={COLORS.textDim}
                    style={s.billCashInput}
                  />
                  <Text style={[s.billInfo, { fontFamily: 'Inter_700Bold', marginBottom: 6, marginTop: 10 }]}>Online Amount</Text>
                  <TextInput
                    value={billSplitOnline}
                    onChangeText={(v) => {
                      setBillSplitOnline(v);
                      const online = Number(v) || 0;
                      setBillSplitCash(online <= billTotal ? String(billTotal - online) : '0');
                    }}
                    keyboardType="numeric"
                    placeholder="Online amount..."
                    placeholderTextColor={COLORS.textDim}
                    style={s.billCashInput}
                  />
                  {(Number(billSplitCash) || 0) + (Number(billSplitOnline) || 0) === billTotal && billSplitCash !== '' && (
                    <View style={[s.billChangeRow, { marginTop: 10 }]}>
                      <Text style={s.billChangeLabel}>Cash: Rs.{billSplitCash} + Online: Rs.{billSplitOnline}</Text>
                      <Text style={[s.billChangeValue, { color: COLORS.green, fontSize: 13 }]}>Matched</Text>
                    </View>
                  )}
                  <Text style={[s.billInfo, { fontFamily: 'Inter_700Bold', marginTop: 10, marginBottom: 6 }]}>Cash Given by Customer</Text>
                  <TextInput
                    value={billCashGiven}
                    onChangeText={setBillCashGiven}
                    keyboardType="numeric"
                    placeholder="Enter cash given..."
                    placeholderTextColor={COLORS.textDim}
                    style={s.billCashInput}
                  />
                  {billCashGiven && Number(billCashGiven) >= (Number(billSplitCash) || 0) && (
                    <View style={s.billChangeRow}>
                      <Text style={s.billChangeLabel}>Change to Return</Text>
                      <Text style={s.billChangeValue}>Rs.{Number(billCashGiven) - (Number(billSplitCash) || 0)}</Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setBillOrder(null)} style={[s.billActionBtn, { backgroundColor: COLORS.inputBg }]}>
                <Text style={[s.billActionBtnText, { color: COLORS.text }]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  // Mark ALL table orders as delivered & paid
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
                style={[s.billActionBtn, { backgroundColor: COLORS.green }]}
              >
                <Text style={s.billActionBtnText}>Settle & Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        );
      })()}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 36, height: 36, borderRadius: 18 },
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

  catRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  catPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.inputBg },
  catPillActive: { backgroundColor: COLORS.crimson },
  catPillText: { color: COLORS.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  catPillTextActive: { color: '#fff' },

  menuImg: { width: 44, height: 44, borderRadius: 10 },
  menuImgPlaceholder: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  vegDot: { width: 8, height: 8, borderRadius: 2 },
  menuName: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  menuNameEn: { color: COLORS.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' },
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

  // Order actions
  orderActionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  orderActionBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  // Bill modal
  billOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  billModal: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%' as any, maxHeight: '85%' as any },
  billHeader: { alignItems: 'center', marginBottom: 8 },
  billTitle: { color: COLORS.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 8, textAlign: 'center' },
  billSubtitle: { color: COLORS.crimson, fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2, textAlign: 'center' },
  billDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 10 },
  billInfo: { color: COLORS.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 2 },
  billItemsHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  billItemText: { color: COLORS.text, fontSize: 12, fontFamily: 'Inter_400Regular' },
  billItemRow: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  billTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billTotalLabel: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  billTotalValue: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  billPayBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center' },
  billPayBtnActive: { backgroundColor: COLORS.crimson, borderColor: COLORS.crimson },
  billPayBtnText: { color: COLORS.text, fontSize: 13, fontFamily: 'Inter_700Bold' },
  billCashInput: { backgroundColor: COLORS.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, fontFamily: 'Inter_400Regular' },
  billChangeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 },
  billChangeLabel: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  billChangeValue: { color: COLORS.green, fontSize: 16, fontFamily: 'Inter_700Bold' },
  billBtn: { backgroundColor: COLORS.green, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  billBtnText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  billActionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  billActionBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },

  notifBanner: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 999, backgroundColor: '#16A34A', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 10 },
  notifText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold', flex: 1 },
  notifDismiss: { color: 'rgba(255,255,255,0.7)', fontSize: 16, paddingLeft: 12 },
});
