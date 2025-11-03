/**
 * Format ISO8601 timestamp for display
 * Shows relative time for recent timestamps, absolute for older ones
 *
 * Examples:
 *   "2 minutes ago"
 *   "1 hour ago"
 *   "yesterday at 3:45 PM"
 *   "Oct 15, 2025 at 2:30 PM"
 *
 * @param {string} isoTimestamp - ISO8601 timestamp (e.g., "2025-11-03T14:23:45.123Z")
 * @param {object} options - Formatting options
 * @param {boolean} options.relative - Use relative time for recent timestamps (default: true)
 * @param {number} options.relativeThreshold - Hours before switching to absolute (default: 48)
 * @returns {string} Formatted timestamp
 */
export function formatTimestamp(isoTimestamp, options = {}) {
  const {
    relative = true,
    relativeThreshold = 48 // hours
  } = options;

  if (!isoTimestamp) return '';

  const now = new Date();
  const timestamp = new Date(isoTimestamp);

  // Calculate difference in milliseconds
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Use relative time for recent timestamps
  if (relative && diffHours < relativeThreshold) {
    // Just now (< 1 minute)
    if (diffMinutes < 1) {
      return 'just now';
    }

    // Minutes ago (< 1 hour)
    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }

    // Hours ago (< 24 hours)
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }

    // Yesterday
    if (diffDays === 1) {
      const time = timestamp.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `yesterday at ${time}`;
    }

    // Days ago (< threshold)
    if (diffDays < Math.floor(relativeThreshold / 24)) {
      const time = timestamp.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${diffDays} days ago at ${time}`;
    }
  }

  // Absolute time for older timestamps
  const date = timestamp.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const time = timestamp.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return `${date} at ${time}`;
}

/**
 * Format timestamp as short relative time (for compact displays)
 *
 * Examples:
 *   "2m" (2 minutes ago)
 *   "3h" (3 hours ago)
 *   "2d" (2 days ago)
 *   "Oct 15" (older than 7 days)
 *
 * @param {string} isoTimestamp - ISO8601 timestamp
 * @returns {string} Short formatted timestamp
 */
export function formatTimestampShort(isoTimestamp) {
  if (!isoTimestamp) return '';

  const now = new Date();
  const timestamp = new Date(isoTimestamp);

  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Minutes
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  // Hours
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  // Days (< 7)
  if (diffDays < 7) {
    return `${diffDays}d`;
  }

  // Date (>= 7 days)
  return timestamp.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format timestamp for sorting (always returns milliseconds since epoch)
 *
 * @param {string} isoTimestamp - ISO8601 timestamp
 * @returns {number} Milliseconds since epoch
 */
export function getTimestampValue(isoTimestamp) {
  if (!isoTimestamp) return 0;
  return new Date(isoTimestamp).getTime();
}

/**
 * Check if timestamp is today
 *
 * @param {string} isoTimestamp - ISO8601 timestamp
 * @returns {boolean} True if timestamp is today
 */
export function isToday(isoTimestamp) {
  if (!isoTimestamp) return false;

  const now = new Date();
  const timestamp = new Date(isoTimestamp);

  return (
    timestamp.getDate() === now.getDate() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getFullYear() === now.getFullYear()
  );
}

/**
 * Check if timestamp is yesterday
 *
 * @param {string} isoTimestamp - ISO8601 timestamp
 * @returns {boolean} True if timestamp is yesterday
 */
export function isYesterday(isoTimestamp) {
  if (!isoTimestamp) return false;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const timestamp = new Date(isoTimestamp);

  return (
    timestamp.getDate() === yesterday.getDate() &&
    timestamp.getMonth() === yesterday.getMonth() &&
    timestamp.getFullYear() === yesterday.getFullYear()
  );
}

/**
 * Group timestamps by date
 *
 * @param {Array<{timestamp: string, ...}>} items - Items with timestamp field
 * @returns {Object} Items grouped by date key (e.g., "2025-11-03")
 */
export function groupByDate(items) {
  const groups = {};

  for (const item of items) {
    if (!item.timestamp) continue;

    const date = new Date(item.timestamp);
    const dateKey = date.toISOString().split('T')[0]; // "2025-11-03"

    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }

    groups[dateKey].push(item);
  }

  return groups;
}

/**
 * Get human-readable date group label
 *
 * @param {string} dateKey - Date key in format "YYYY-MM-DD"
 * @returns {string} Human-readable label (e.g., "Today", "Yesterday", "Oct 15, 2025")
 */
export function getDateGroupLabel(dateKey) {
  const date = new Date(dateKey + 'T00:00:00');
  const now = new Date();

  // Today
  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return 'Today';
  }

  // Yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  }

  // This week (last 7 days)
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  // Older
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
