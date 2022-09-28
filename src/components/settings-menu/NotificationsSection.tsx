import lang from 'i18n-js';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Linking, Switch } from 'react-native';
import { ContactAvatar } from '../contacts';
import ImageAvatar from '../contacts/ImageAvatar';
import Menu from './components/Menu';
import MenuContainer from './components/MenuContainer';
import MenuItem from './components/MenuItem';
import { checkNotifications, RESULTS } from 'react-native-permissions';
import { useNavigation } from '@/navigation';
import Routes from '@/navigation/routesNames';
import WalletTypes from '@/helpers/walletTypes';
import { useAccountSettings, useWallets } from '@/hooks';
import profileUtils from '@/utils/profileUtils';
import {
  NotificationRelationship,
  updateSettingsForWallets,
  useAllNotificationSettingsFromStorage,
  useWalletGroupNotificationSettings,
  WalletNotificationSettingsType,
} from '@/notifications/settings';
import { abbreviations, deviceUtils } from '@/utils';
import { Box } from '@/design-system';
import { removeFirstEmojiFromString } from '@/helpers/emojiHandler';
import { RainbowAccount } from '@/model/wallet';
import { isTestnetNetwork } from '@/handlers/web3';

type WalletRowProps = {
  groupOff: boolean;
  isTestnet: boolean;
  wallet: RainbowAccount;
  toggleNotifications: () => void;
  ens: string;
  notificationSettings: WalletNotificationSettingsType[];
};

type WalletRowLabelProps = {
  groupOff: boolean;
  notifications?: WalletNotificationSettingsType;
};

const DEVICE_WIDTH = deviceUtils.dimensions.width;
const AMOUNT_OF_TOPICS_TO_DISPLAY = DEVICE_WIDTH > 400 ? 3 : 2;

const WalletRowLabel = ({ notifications, groupOff }: WalletRowLabelProps) => {
  const composedLabel = useMemo(() => {
    if (!notifications) return lang.t('settings.notifications_section.off');
    const allTopicsEnabled = Object.values(notifications.topics).every(
      topic => topic
    );
    const allTopicsDisabled =
      groupOff || Object.values(notifications.topics).every(topic => !topic);
    const enabledTopics = Object.keys(notifications.topics).filter(
      topic => notifications.topics[(topic as unknown) as number]
    );

    if (allTopicsDisabled) {
      return lang.t('settings.notifications_section.off');
    }

    if (notifications.enabled) {
      if (allTopicsEnabled) {
        return lang.t('settings.notifications_section.all');
      }

      if (enabledTopics.length > AMOUNT_OF_TOPICS_TO_DISPLAY) {
        const limitedTopics = enabledTopics
          .slice(0, AMOUNT_OF_TOPICS_TO_DISPLAY)
          .map(topic => lang.t(`settings.notifications_section.${topic}`))
          .join(', ');

        return `${limitedTopics} ${lang.t(
          'settings.notifications_section.plus_n_more',
          {
            n: enabledTopics.length - AMOUNT_OF_TOPICS_TO_DISPLAY,
          }
        )}`;
      } else {
        return enabledTopics
          .map(topic => lang.t(`settings.notifications_section.${topic}`))
          .join(', ');
      }
    } else {
      return lang.t('settings.notifications_section.off');
    }
  }, [groupOff, notifications]);

  return <MenuItem.Label text={composedLabel} />;
};

const WalletRow = ({
  wallet,
  groupOff,
  isTestnet,
  toggleNotifications,
  notificationSettings,
  ens,
}: WalletRowProps) => {
  const { navigate } = useNavigation();
  const notificationSetting = notificationSettings?.find(
    (x: WalletNotificationSettingsType) => x.address === wallet.address
  );
  const cleanedUpLabel = useMemo(
    () => removeFirstEmojiFromString(wallet.label),
    [wallet.label]
  );

  const displayAddress = useMemo(
    () => abbreviations.address(wallet.address, 4, 6),
    [wallet.address]
  );
  const walletName = cleanedUpLabel || ens || displayAddress || '';

  const navigateToWalletSettings = useCallback(
    (name, address) => {
      navigate(Routes.WALLET_NOTIFICATIONS_SETTINGS, {
        title: name,
        address,
        toggleNotifications,
      });
    },
    [navigate, toggleNotifications]
  );

  const rowEnabled = useMemo(() => {
    const enabledTopics = notificationSetting
      ? Object.values(notificationSetting.topics).filter(topic =>
          Boolean(topic)
        )
      : [];
    return !groupOff && enabledTopics.length && notificationSetting?.enabled;
  }, [groupOff, notificationSetting]);

  return (
    <MenuItem
      disabled={isTestnet}
      key={wallet.address}
      hasRightArrow={!isTestnet}
      labelComponent={
        <WalletRowLabel
          notifications={notificationSetting}
          groupOff={groupOff}
        />
      }
      leftComponent={
        <Box
          style={{
            opacity: rowEnabled ? 1 : 0.25,
          }}
        >
          {wallet.image ? (
            <ImageAvatar image={wallet.image} size="smedium" />
          ) : (
            <ContactAvatar
              color={wallet.color}
              size="small"
              value={profileUtils.addressHashedEmoji(wallet.address)}
            />
          )}
        </Box>
      }
      onPress={() => navigateToWalletSettings(walletName, wallet.address)}
      size={52}
      titleComponent={<MenuItem.Title text={walletName} />}
    />
  );
};

const NotificationsSection = () => {
  const { navigate } = useNavigation();
  const { network } = useAccountSettings();
  const isTestnet = isTestnetNetwork(network);
  const { wallets, walletNames } = useWallets();

  const {
    ownerEnabled,
    watcherEnabled,
    updateGroupSettings,
  } = useWalletGroupNotificationSettings();
  const { notificationSettings } = useAllNotificationSettingsFromStorage();
  const { ownedWallets, watchedWallets } = useMemo(() => {
    const ownedWallets: RainbowAccount[] = [];
    const watchedWallets: RainbowAccount[] = [];
    // group wallets by relationship if the arrays are empty
    if (watchedWallets.length === 0 && ownedWallets.length === 0) {
      const walletIDs = Object.keys(wallets!);
      walletIDs.forEach(key => {
        const wallet = wallets?.[key];

        if (wallet?.type === WalletTypes.readOnly) {
          wallet?.addresses.forEach(
            item => item.visible && watchedWallets.push({ ...item })
          );
        } else {
          wallet?.addresses.forEach(
            item => item.visible && ownedWallets.push(item)
          );
        }
      });
    }

    return { ownedWallets, watchedWallets };
  }, [wallets]);

  const noOwnedWallets = !ownedWallets.length;
  const noWatchedWallets = !watchedWallets.length;

  const [permissionStatus, setPermissionStatus] = useState<string | boolean>(
    false
  );
  const noPermissions = permissionStatus !== RESULTS.GRANTED;

  useEffect(() => {
    checkNotifications().then(({ status }) => {
      setPermissionStatus(status);
    });
  }, [ownedWallets, wallets, watchedWallets]);

  const toggleAllOwnedNotifications = useCallback(() => {
    updateSettingsForWallets(NotificationRelationship.OWNER, {
      enabled: !ownerEnabled,
    });
    updateGroupSettings({
      [NotificationRelationship.OWNER]: !ownerEnabled,
    });
  }, [ownerEnabled, updateGroupSettings]);

  const toggleAllOwnedNotificationsFromWallet = useCallback(() => {
    updateGroupSettings({
      [NotificationRelationship.OWNER]: !ownerEnabled
        ? !ownerEnabled
        : ownerEnabled,
    });
  }, [ownerEnabled, updateGroupSettings]);

  const toggleAllWatchedNotifications = useCallback(() => {
    updateSettingsForWallets(NotificationRelationship.WATCHER, {
      enabled: !watcherEnabled,
    });
    updateGroupSettings({
      [NotificationRelationship.WATCHER]: !watcherEnabled,
    });
  }, [updateGroupSettings, watcherEnabled]);

  const toggleAllWatchedNotificationsFromWallet = useCallback(() => {
    updateGroupSettings({
      [NotificationRelationship.WATCHER]: !watcherEnabled
        ? !watcherEnabled
        : watcherEnabled,
    });
  }, [updateGroupSettings, watcherEnabled]);

  const openSystemSettings = Linking.openSettings;
  const openNetworkSettings = useCallback(
    () => navigate(Routes.NETWORK_SWITCHER),
    [navigate]
  );

  return (
    <Box>
      <MenuContainer>
        {noPermissions && (
          <Menu
            description={lang.t(
              'settings.notifications_section.no_permissions'
            )}
          >
            <MenuItem
              hasSfSymbol
              size={52}
              leftComponent={<MenuItem.TextIcon icon="􀍟" isLink />}
              titleComponent={
                <MenuItem.Title
                  text={lang.t(
                    'settings.notifications_section.open_system_settings'
                  )}
                  weight="bold"
                  isLink
                />
              }
              onPress={openSystemSettings}
            />
          </Menu>
        )}

        {isTestnet ? (
          <Menu
            description={lang.t(
              'settings.notifications_section.unsupported_network'
            )}
          >
            <MenuItem
              hasSfSymbol
              size={52}
              leftComponent={<MenuItem.TextIcon icon="􀇂" isLink />}
              titleComponent={
                <MenuItem.Title
                  text={lang.t('settings.notifications_section.change_network')}
                  weight="bold"
                  isLink
                />
              }
              onPress={openNetworkSettings}
            />
          </Menu>
        ) : (
          <>
            <Menu
              description={
                noOwnedWallets
                  ? lang.t('settings.notifications_section.no_owned_wallets')
                  : ''
              }
            >
              <MenuItem
                disabled
                rightComponent={
                  <Switch
                    disabled={noOwnedWallets || isTestnet}
                    onValueChange={toggleAllOwnedNotifications}
                    value={ownerEnabled}
                  />
                }
                size={52}
                titleComponent={
                  <MenuItem.Title
                    text={lang.t('settings.notifications_section.my_wallets')}
                    weight="bold"
                  />
                }
              />
              {ownedWallets.map(wallet => (
                <WalletRow
                  key={wallet.address}
                  wallet={wallet}
                  groupOff={!ownerEnabled}
                  isTestnet={isTestnet}
                  ens={walletNames[wallet.address]}
                  notificationSettings={notificationSettings}
                  toggleNotifications={toggleAllOwnedNotificationsFromWallet}
                />
              ))}
            </Menu>
            <Menu
              description={
                noWatchedWallets
                  ? lang.t('settings.notifications_section.no_watched_wallets')
                  : ''
              }
            >
              <MenuItem
                disabled
                rightComponent={
                  <Switch
                    disabled={noWatchedWallets || isTestnet}
                    onValueChange={toggleAllWatchedNotifications}
                    value={watcherEnabled}
                  />
                }
                size={52}
                titleComponent={
                  <MenuItem.Title
                    text={lang.t(
                      'settings.notifications_section.watched_wallets'
                    )}
                    weight="bold"
                  />
                }
              />
              {watchedWallets.map(wallet => (
                <WalletRow
                  key={wallet.address}
                  wallet={wallet}
                  groupOff={!watcherEnabled}
                  isTestnet={isTestnet}
                  ens={walletNames[wallet.address]}
                  notificationSettings={notificationSettings}
                  toggleNotifications={toggleAllWatchedNotificationsFromWallet}
                />
              ))}
            </Menu>
          </>
        )}
      </MenuContainer>
    </Box>
  );
};

export default NotificationsSection;
