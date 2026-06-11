import { Vibration, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Configure notifications to show even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensurePermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

export async function playKitchenNotification() {
  // Vibration
  Vibration.vibrate([0, 300, 200, 300, 200, 500]);
  // System push notification
  await ensurePermissions();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'New Order!',
      body: 'A new order has been placed. Check the kitchen display.',
      sound: true,
    },
    trigger: null, // immediate
  });
}

export async function playWaiterNotification(orderNum?: string) {
  // Vibration
  Vibration.vibrate([0, 200, 150, 400]);
  // System push notification
  await ensurePermissions();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Order Ready!',
      body: orderNum
        ? `Order ${orderNum} is READY - Pick up from kitchen!`
        : 'An order is ready for pickup!',
      sound: true,
    },
    trigger: null,
  });
}

export async function playBillNotification(orderNum?: string) {
  Vibration.vibrate([0, 200, 100, 200]);
  await ensurePermissions();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Bill Generated',
      body: orderNum
        ? `Bill for ${orderNum} has been generated.`
        : 'A bill has been auto-generated.',
      sound: true,
    },
    trigger: null,
  });
}

export async function unloadSounds() {}
