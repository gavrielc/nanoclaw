import { describe, it, expect, vi } from 'vitest';

import { eventBus } from './event-bus.js';
import type { ComplaintEvent, StatusChangeEvent } from './event-bus.js';

describe('eventBus', () => {
  it('emits and receives complaint:created event', () => {
    const handler = vi.fn();
    eventBus.on('complaint:created', handler);

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919876543210',
      category: 'water_supply',
      description: 'No water for 3 days',
      location: 'Ward 7',
      language: 'mr',
      status: 'registered',
    };

    eventBus.emit('complaint:created', event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);

    eventBus.removeAllListeners('complaint:created');
  });

  it('emits and receives complaint:status-changed event', () => {
    const handler = vi.fn();
    eventBus.on('complaint:status-changed', handler);

    const event: StatusChangeEvent = {
      complaintId: 'RK-20260211-0001',
      phone: '919876543210',
      oldStatus: 'registered',
      newStatus: 'in_progress',
      note: 'Contacted water department',
      updatedBy: '918600822444',
    };

    eventBus.emit('complaint:status-changed', event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);

    eventBus.removeAllListeners('complaint:status-changed');
  });

  it('fires multiple listeners on same event', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    eventBus.on('complaint:created', handler1);
    eventBus.on('complaint:created', handler2);

    const event: ComplaintEvent = {
      complaintId: 'RK-20260211-0002',
      phone: '919999999999',
      description: 'Pothole on road',
      language: 'hi',
      status: 'registered',
    };

    eventBus.emit('complaint:created', event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    eventBus.removeAllListeners('complaint:created');
  });
});
