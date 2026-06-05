let Audio: any = null;
let kitchenSound: any = null;
let waiterSound: any = null;

async function getAudio() {
  if (Audio) return Audio;
  try {
    const mod = require('expo-av');
    Audio = mod.Audio;
    return Audio;
  } catch {
    return null;
  }
}

export async function playKitchenNotification() {
  try {
    const A = await getAudio();
    if (!A) return;
    await A.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    if (kitchenSound) { await kitchenSound.replayAsync(); return; }
    const { sound } = await A.Sound.createAsync(
      require('../assets/sounds/new-order.wav'),
      { shouldPlay: true, volume: 1.0 }
    );
    kitchenSound = sound;
  } catch (e) {
    console.log('Kitchen sound unavailable:', e);
  }
}

export async function playWaiterNotification() {
  try {
    const A = await getAudio();
    if (!A) return;
    await A.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    if (waiterSound) { await waiterSound.replayAsync(); return; }
    const { sound } = await A.Sound.createAsync(
      require('../assets/sounds/order-ready.wav'),
      { shouldPlay: true, volume: 1.0 }
    );
    waiterSound = sound;
  } catch (e) {
    console.log('Waiter sound unavailable:', e);
  }
}

export async function unloadSounds() {
  try {
    if (kitchenSound) { await kitchenSound.unloadAsync(); kitchenSound = null; }
    if (waiterSound) { await waiterSound.unloadAsync(); waiterSound = null; }
  } catch {}
}
