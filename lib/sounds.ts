import { Audio } from 'expo-av';
import { Platform } from 'react-native';

let kitchenSound: Audio.Sound | null = null;
let waiterSound: Audio.Sound | null = null;

// Simple beep notification using a data URI (short sine wave)
// This generates a quick notification tone without needing an external audio file
const BEEP_URI = Platform.OS === 'web'
  ? 'data:audio/wav;base64,UklGRl9vT19teleHa2VmbXQgEAAAAAEAAQBBIgAAQSIAAAEACABkYXRhQW9PXw=='
  : undefined;

async function ensureAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

/**
 * Play a notification sound for the kitchen when a new order arrives.
 * Uses 3 short beeps pattern.
 */
export async function playKitchenNotification() {
  try {
    await ensureAudioMode();
    // Use system alert sound or a generated tone
    if (kitchenSound) {
      await kitchenSound.replayAsync();
      return;
    }
    // Create a sound from the bundled asset
    const { sound } = await Audio.Sound.createAsync(
      require('../assets/sounds/new-order.wav'),
      { shouldPlay: true, volume: 1.0 }
    );
    kitchenSound = sound;
  } catch (e) {
    // Fallback: vibrate or log
    console.log('Kitchen sound error:', e);
  }
}

/**
 * Play a notification sound for the waiter when an order is ready.
 * Uses a different tone pattern.
 */
export async function playWaiterNotification() {
  try {
    await ensureAudioMode();
    if (waiterSound) {
      await waiterSound.replayAsync();
      return;
    }
    const { sound } = await Audio.Sound.createAsync(
      require('../assets/sounds/order-ready.wav'),
      { shouldPlay: true, volume: 1.0 }
    );
    waiterSound = sound;
  } catch (e) {
    console.log('Waiter sound error:', e);
  }
}

/**
 * Cleanup sounds when component unmounts.
 */
export async function unloadSounds() {
  if (kitchenSound) { await kitchenSound.unloadAsync(); kitchenSound = null; }
  if (waiterSound) { await waiterSound.unloadAsync(); waiterSound = null; }
}
