import React from 'react';
import './styles.scss';

export interface ChatChannel {
  // Identifier used internally and persisted as the active channel.
  id: string;
  // Short label shown on the selector button.
  label: string;
  // Slash-command prefix prepended to outgoing messages for this channel.
  // An empty string means the message is sent verbatim (the server treats
  // unprefixed text as /say), preserving the historical default behaviour.
  cmd: string;
  // Extra class used to colour the active channel, mirroring the message
  // colours already defined in ../styles.scss (.action, .admin, ...).
  className: string;
}

export const CHAT_CHANNELS: ChatChannel[] = [
  { id: 'local',    label: 'Local',    cmd: '',          className: 'channel-local' },
  { id: 'global',   label: 'Global',   cmd: '/ooc ',     className: 'channel-global' },
  { id: 'admin',    label: 'Admin',    cmd: '/admin ',   className: 'channel-admin' },
  { id: 'personal', label: 'Personal', cmd: '/pm ',      className: 'channel-pm' },
];

export const DEFAULT_CHANNEL = CHAT_CHANNELS[0].id; // 'local'

// Applies the active channel's prefix to a message. If the player typed an
// explicit slash-command we respect it and add no prefix, so manual commands
// like "/me waves" or "/roll" keep working regardless of the selected channel.
export const applyChannel = (text: string, channelId: string): string => {
  if (text.startsWith('/')) {
    return text;
  }
  const channel = CHAT_CHANNELS.find((c) => c.id === channelId);
  return channel && channel.cmd ? channel.cmd + text : text;
};

const Channels = (props: {
  active: string,
  onSelect: (id: string) => void,
  unread?: Record<string, boolean>,
}) => {
  return (
    <div className="chat-channels">
      {CHAT_CHANNELS
        .filter((channel) => channel.id !== 'admin' || (window as any).__skyrpAdmin)
        .map((channel) => (
          <button
            key={channel.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onSelect(channel.id)}
            className={`chat-channel ${channel.className} ${props.active === channel.id ? 'active' : ''}`}
          >
            {channel.label}
            {props.unread && props.unread[channel.id] && props.active !== channel.id
              ? <span className="chat-channel-unread" /> : null}
          </button>
        ))}
    </div>
  );
};

export default Channels;
