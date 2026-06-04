export interface RestaurantTable {
  id: string;
  table_number: string;
  capacity: number;
  zone: string;
  status: 'available' | 'occupied' | 'reserved';
}

export interface MenuItem {
  id: string;
  category: string;
  price: number;
  is_veg: boolean;
  is_available: boolean;
  name_en: string;
  name_mr: string;
  name_hi: string;
  name_kn: string;
  description_en: string;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  order_status: string;
  order_type: string;
  table_id: string | null;
  items: { id: string; name: string; qty: number; price: number }[];
  subtotal: number;
  total: number;
  created_at: string;
  special_instructions: string | null;
  payment_method: string;
}

export type StaffRole = 'waiter' | 'kitchen';
