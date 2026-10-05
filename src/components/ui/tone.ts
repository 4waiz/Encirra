import type { Category, EventCategory, IncidentCategory, Severity, SensorStatus, Tone } from '../../types';

export const TONE_HEX: Record<Tone, string> = {
  neutral: '#8a96a3',
  info: '#3cc8dc',
  ok: '#3dd68c',
  watch: '#f2b33d',
  warn: '#ff8a3d',
  critical: '#f0534d',
  offline: '#6b7785',
};

export const CATEGORY_HEX: Record<Category | 'thermal' | 'network' | 'multi' | 'asset' | 'system' | 'ai', string> = {
  chem: '#2dd4bf',
  bio: '#6ec1f5',
  rad: '#ff9142',
  nuc: '#8aa4ff',
  thermal: '#ff6a5c',
  network: '#a7b1bb',
  multi: '#ff9142',
  asset: '#4c94ff',
  system: '#a7b1bb',
  ai: '#b4a8ff',
};

export const SENSOR_STATUS_TONE: Record<SensorStatus, Tone> = {
  online: 'ok',
  elevated: 'watch',
  alert: 'warn',
  offline: 'offline',
};

export const SENSOR_STATUS_LABEL: Record<SensorStatus, string> = {
  online: 'Nominal',
  elevated: 'Elevated · under review',
  alert: 'Alert · review required',
  offline: 'No data',
};

export const SEVERITY_TONE: Record<Severity, Tone> = { low: 'watch', moderate: 'warn', high: 'critical' };
export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', moderate: 'Moderate', high: 'High' };

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  chem: 'Chemical',
  bio: 'Biological',
  rad: 'Radiological',
  asset: 'Assets',
  system: 'System',
  ai: 'AI fusion',
};

export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  chem: 'Chemical',
  bio: 'Biological',
  rad: 'Radiological',
  nuc: 'Nuclear readiness',
  thermal: 'Thermal',
  network: 'Network',
  multi: 'Multi-source',
};
