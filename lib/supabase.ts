import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://rwvfmmnflfwwyjlepgfw.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3dmZtbW5mbGZ3d3lqbGVwZ2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTI0MTUsImV4cCI6MjA5NTEyODQxNX0.2APylYtbnQGt4-ms5S5nkprh_5flI_8GCJljOsLIEdg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'staff-app-auth',
  },
});
