import { createContext, useContext } from 'react';

/** Deployment capability comes from the original API, never from a browser preference. */
export type DeliveryCapability = {
  mode: 'manual' | 'wordpress';
  wordpressWritesAllowed: boolean;
  draftPushAllowed: boolean;
  readOnlyRecoveryAllowed: boolean;
  message: string | null;
};

export const unavailableDelivery: DeliveryCapability = {
  mode: 'manual', wordpressWritesAllowed: false, draftPushAllowed: false,
  readOnlyRecoveryAllowed: true,
  message: '交付方式暂未读取成功。已保存的稿件和历史记录仍可查看，请刷新后继续。',
};

export const DeliveryContext = createContext<DeliveryCapability>(unavailableDelivery);
export const useDelivery = () => useContext(DeliveryContext);
