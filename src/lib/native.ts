import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { Group, Poll } from '../types';

type PermissionState = {
  platform: string;
  notificationsGranted: boolean;
  notificationsEnabled: boolean;
  fullScreenIntentGranted: boolean;
};

type PendingPollAction = {
  action?: 'yes' | 'no' | 'later' | 'open';
  pollId?: string;
};

interface PollNotificationsPlugin {
  initialize(): Promise<PermissionState>;
  getPermissionStatus(): Promise<PermissionState>;
  requestNotificationPermission(): Promise<PermissionState>;
  openFullScreenSettings(): Promise<PermissionState>;
  openNotificationSettings(): Promise<PermissionState>;
  showPoll(options: {
    pollId: string;
    groupName: string;
    groupEmoji: string;
    title: string;
    dateLabel: string;
    bsDate: string;
    timeLabel: string;
    yesCount: number;
    minYes: number;
    remindAfterMinutes: number;
    pollType: 'yes_no' | 'options';
  }): Promise<{ shown: boolean }>;
  cancelPoll(options: { pollId: string }): Promise<void>;
  getPendingActions(): Promise<{ actions:PendingPollAction[] }>;
}

interface NativeSecurityPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  authenticate(options: { title: string; subtitle: string; fallbackLabel?:string }): Promise<{ verified: boolean }>;
  storeSession(options:{token:string;credentialId:string}):Promise<void>;
  hasStoredSession():Promise<{available:boolean;credentialId:string}>;
  authenticateSession():Promise<{verified:boolean;token?:string;credentialId?:string;error?:string}>;
  clearStoredSession():Promise<void>;
}

interface PaymentNotificationsPlugin {
  showIncoming(options: {
    requestId: string;
    senderName: string;
    amount: number;
    purpose: string;
  }): Promise<{ shown: boolean }>;
}

interface AppNotificationsPlugin {
  show(options: {
    notificationId: string;
    title: string;
    body: string;
    type: string;
    persistentUntil?: string;
    persistentUntilMs?: number;
  }): Promise<{ shown:boolean }>;
}

export const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const PollNotifications = registerPlugin<PollNotificationsPlugin>('PollNotifications');
export const PaymentNotifications = registerPlugin<PaymentNotificationsPlugin>('PaymentNotifications');
export const AppNotifications = registerPlugin<AppNotificationsPlugin>('AppNotifications');
export const NativeSecurity = registerPlugin<NativeSecurityPlugin>('NativeSecurity');

export async function prepareNativeNotifications() {
  if (!isNativeAndroid) return null;
  return PollNotifications.initialize();
}

export async function requestNativeNotificationPermission() {
  if (!isNativeAndroid) return null;
  return PollNotifications.requestNotificationPermission();
}

export async function showNativePoll(group: Group, poll: Poll) {
  if (!isNativeAndroid) return false;
  const event = new Date(poll.eventAt);
  const result=await PollNotifications.showPoll({
    pollId: poll.id,
    groupName: group.name,
    groupEmoji: group.emoji,
    title: poll.title,
    dateLabel: event.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    bsDate: poll.bsDate,
    timeLabel: event.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    yesCount: poll.yesCount,
    minYes: poll.minYes,
    remindAfterMinutes: 120,
    pollType: poll.pollType,
  });
  return result.shown;
}

export async function showNativePayment(requestId:string,senderName:string,amount:number,purpose:string) {
  if (!isNativeAndroid) return false;
  const result=await PaymentNotifications.showIncoming({requestId,senderName,amount,purpose});
  return result.shown;
}

export async function showNativeInboxNotification(item:{id:string;title:string;body:string;type:string;persistentUntil?:string}) {
  if (!isNativeAndroid) return false;
  const result=await AppNotifications.show({notificationId:item.id,title:item.title,body:item.body,type:item.type,persistentUntil:item.persistentUntil,persistentUntilMs:item.persistentUntil?new Date(item.persistentUntil).getTime():0});
  return result.shown;
}

export async function nativeBiometricConfirm(title: string, subtitle: string, fallbackLabel = 'Use MPIN') {
  if (!isNativeAndroid) return false;
  const availability = await NativeSecurity.isAvailable();
  if (!availability.available) return false;
  const result = await NativeSecurity.authenticate({ title, subtitle, fallbackLabel });
  if (result.verified) await Haptics.impact({ style: ImpactStyle.Medium });
  return result.verified;
}

export async function storedBiometricSession() {
  if (!isNativeAndroid) return {available:false,credentialId:''};
  return NativeSecurity.hasStoredSession();
}

export async function rememberBiometricSession(token:string,credentialId:string) {
  if (!isNativeAndroid) return;
  await NativeSecurity.storeSession({token,credentialId});
}

export async function biometricSessionLogin() {
  if (!isNativeAndroid) return null;
  return NativeSecurity.authenticateSession();
}

export function onNativeAppResume(callback: () => void) {
  if (!isNativeAndroid) return () => undefined;
  const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) callback(); });
  return () => { void handle.then(listener => listener.remove()); };
}
