import {
  DEFAULT_ENABLED_TOPIC_SETTINGS,
  NotificationRelationship,
  NOTIFICATIONS_DEFAULT_CHAIN_ID,
  WALLET_GROUPS_STORAGE_KEY,
} from '@/notifications/settings/constants';
import {
  AddressWithRelationship,
  WalletNotificationSettings,
} from '@/notifications/settings/types';
import {
  getAllNotificationSettingsFromStorage,
  notificationSettingsStorage,
  setAllNotificationSettingsToStorage,
} from '@/notifications/settings/storage';
import { notificationsSubscription } from '@/redux/explorer';
import store, { AppDispatch } from '@/redux/store';
import {
  subscribeWalletToAllEnabledTopics,
  unsubscribeWalletFromAllNotificationTopics,
} from '@/notifications/settings/firebase';
import { InteractionManager } from 'react-native';
import { logger, RainbowError } from '@/logger';
import { removeNotificationSettingsForWallet } from '@/notifications/settings/settings';

/**
 Checks if group notification settings are present in storage
 and adds default values for them if they do not exist.
 */
export const addDefaultNotificationGroupSettings = () => {
  const data = notificationSettingsStorage.getString(WALLET_GROUPS_STORAGE_KEY);

  if (!data) {
    const defaultSettings = {
      [NotificationRelationship.OWNER]: true,
      [NotificationRelationship.WATCHER]: false,
    };
    notificationSettingsStorage.set(
      WALLET_GROUPS_STORAGE_KEY,
      JSON.stringify(defaultSettings)
    );
  }
};

/**
 * Adds fresh disabled settings for all wallets that didn't have settings
 */
export const initializeNotificationSettingsForAddresses = (
  addresses: AddressWithRelationship[]
) => {
  const currentSettings = getAllNotificationSettingsFromStorage();
  const newSettings: WalletNotificationSettings[] = [...currentSettings];
  const alreadySaved = new Map<
    string,
    { index: number; settings: WalletNotificationSettings }
  >();
  const alreadyFinishedInitialSubscriptions = new Set();
  const subscriptionQueue: WalletNotificationSettings[] = [];

  // Initialize hashmap and a set
  newSettings.forEach((entry, index) => {
    alreadySaved.set(entry.address, { settings: entry, index });
    if (entry.successfullyFinishedInitialSubscription) {
      alreadyFinishedInitialSubscriptions.add(entry.address);
    }
  });
  // Set of wallet addresses we have in app (unrelated to notification settings entries)
  const walletAddresses = new Set(
    addresses.map(addressWithRelationship => addressWithRelationship.address)
  );
  const removedWalletsThatWereNotUnsubscribedProperly: string[] = [
    ...alreadySaved.keys(),
  ].filter(address => !walletAddresses.has(address));

  // preparing list of wallets that need to be subscribed
  addresses.forEach(entry => {
    store.dispatch(notificationsSubscription(entry.address));
    const alreadySavedEntry = alreadySaved.get(entry.address);
    // handling a case where we import a seed phrase of a previously watched wallet
    if (
      alreadySavedEntry !== undefined &&
      alreadySavedEntry.settings.type !== entry.relationship
    ) {
      const oldSettingsEntry = newSettings[alreadySavedEntry.index];
      const updatedSettingsEntry = {
        ...oldSettingsEntry,
        topics: DEFAULT_ENABLED_TOPIC_SETTINGS,
        type: entry.relationship,
        successfullyFinishedInitialSubscription: false,
        oldType: alreadySavedEntry.settings.type,
      };
      newSettings[alreadySavedEntry.index] = updatedSettingsEntry;
      subscriptionQueue.push(updatedSettingsEntry);
    } else if (
      alreadySavedEntry !== undefined &&
      (alreadySavedEntry.settings?.oldType !== undefined ||
        !alreadySavedEntry.settings.successfullyFinishedInitialSubscription)
    ) {
      subscriptionQueue.push(alreadySavedEntry.settings);
    } else if (!alreadySaved.has(entry.address)) {
      const newSettingsEntry: WalletNotificationSettings = {
        type: entry.relationship,
        address: entry.address,
        topics: DEFAULT_ENABLED_TOPIC_SETTINGS,
        enabled: false,
        // Watched wallets are not automatically subscribed to topics, so they already have applied defaults
        successfullyFinishedInitialSubscription:
          entry.relationship === NotificationRelationship.WATCHER,
      };
      newSettings.push(newSettingsEntry);
    }
  });

  setAllNotificationSettingsToStorage(newSettings);
  if (removedWalletsThatWereNotUnsubscribedProperly.length) {
    InteractionManager.runAfterInteractions(() => {
      removedWalletsThatWereNotUnsubscribedProperly.forEach(address => {
        removeNotificationSettingsForWallet(address);
      });
    });
  }
  InteractionManager.runAfterInteractions(() => {
    processSubscriptionQueue(subscriptionQueue);
  });
};

const processSubscriptionQueue = async (
  subscriptionQueue: WalletNotificationSettings[]
): Promise<void> => {
  const results = await Promise.all(
    subscriptionQueue.map(item => processSubscriptionQueueItem(item))
  );
  const newSettings = [...getAllNotificationSettingsFromStorage()];
  const settingsIndexMap = new Map<string, number>(
    newSettings.map((entry, index) => [entry.address, index])
  );
  results.forEach(result => {
    const index = settingsIndexMap.get(result.address);
    if (index !== undefined && newSettings[index] !== undefined) {
      newSettings[index] = result;
    }
  });

  setAllNotificationSettingsToStorage(newSettings);
};

const processSubscriptionQueueItem = async (
  queueItem: WalletNotificationSettings
) => {
  const newSettings = { ...queueItem };
  if (newSettings.oldType !== undefined) {
    try {
      await unsubscribeWalletFromAllNotificationTopics(
        newSettings.oldType,
        NOTIFICATIONS_DEFAULT_CHAIN_ID,
        newSettings.address
      );
      newSettings.oldType = undefined;
    } catch (e) {
      logger.error(
        new RainbowError(
          'Failed to unsubscribe old watcher mode notification topics'
        )
      );
    }
  }
  if (
    newSettings.type === NotificationRelationship.OWNER &&
    !newSettings.successfullyFinishedInitialSubscription
  ) {
    try {
      await subscribeWalletToAllEnabledTopics(
        newSettings,
        NOTIFICATIONS_DEFAULT_CHAIN_ID
      );
      newSettings.successfullyFinishedInitialSubscription = true;
      newSettings.enabled = true;
    } catch (e) {
      logger.error(
        new RainbowError(
          'Failed to subscribe to default notification topics for newly added wallet'
        )
      );
    }
  }

  return newSettings;
};
// Runs some MMKV operations when the app is loaded
// to ensure that settings are always present
addDefaultNotificationGroupSettings();
