/**
 * Channel Router — ACL & Subscription Management
 *
 * Validates that clients can subscribe to specific channels
 * based on their role and tenant context.
 */

import { ChannelType } from '../types/events';

export interface UserContext {
  userId: string;
  tenantId: string | null;
  role: string;
  siteIds?: string[]; // Sites the user has access to
}

/**
 * Check if a user can subscribe to a channel.
 */
export function canSubscribe(user: UserContext, channel: ChannelType): boolean {
  // Admin can subscribe to everything
  if (user.role === 'ADMIN') return true;

  // Tenant-level access
  if (channel.startsWith('tenant:')) {
    const tenantId = channel.replace('tenant:', '');
    // Dispatcher can only see their own tenant
    if (user.role === 'DISPATCHER') return user.tenantId === tenantId;
    return user.tenantId === tenantId;
  }

  // Site-level access
  if (channel.startsWith('site:')) {
    const siteId = channel.replace('site:', '');

    // Wildcard: dispatchers can see all sites
    if (channel === 'site:*' && user.role === 'DISPATCHER') return true;

    return user.siteIds?.includes(siteId) || user.role === 'DISPATCHER';
  }

  // Report-level: anyone who has site access
  if (channel.startsWith('report:')) {
    return user.role !== 'ASSISTANT' || !!user.siteIds;
  }

  // Operator-level: user can see own reports
  if (channel.startsWith('operator:')) {
    const operatorId = channel.replace('operator:', '');
    return user.userId === operatorId;
  }

  // Alert channels: dispatchers and admins
  if (channel.startsWith('alert:')) {
    return user.role === 'ADMIN' || user.role === 'DISPATCHER';
  }

  return false;
}

/**
 * Get default channels for a user context.
 */
export function getDefaultChannels(user: UserContext): ChannelType[] {
  const channels: ChannelType[] = [];

  // Everyone gets tenant channel
  if (user.tenantId) {
    channels.push(`tenant:${user.tenantId}`);
  }

  // Dispatchers get wildcard site access
  if (user.role === 'DISPATCHER') {
    channels.push('site:*');
    channels.push('alert:high');
  }

  // Operators get their site channels
  if (user.siteIds) {
    for (const siteId of user.siteIds) {
      channels.push(`site:${siteId}`);
    }
  }

  // Admin gets all alerts
  if (user.role === 'ADMIN') {
    channels.push('alert:*');
  }

  return channels;
}

/**
 * Compute event target channels for routing.
 */
export function getEventChannels(event: {
  tenantId: string | null;
  siteId: string | null;
  entity: string;
  entityId: string;
  userId: string | null;
}): string[] {
  const channels: string[] = [];

  if (event.tenantId) channels.push(`tenant:${event.tenantId}`);
  if (event.siteId) channels.push(`site:${event.siteId}`);
  channels.push(`${event.entity}:${event.entityId}`);
  if (event.userId) channels.push(`operator:${event.userId}`);

  // High-severity events go to alert channels
  if (event.entity === 'alert') {
    channels.push('alert:high');
  }

  return channels;
}
