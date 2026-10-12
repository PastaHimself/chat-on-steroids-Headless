export interface HealthComponent {
  id: string;
  label: string;
  state: 'available' | 'attention' | 'unknown';
  observedAt: number;
  detail: string;
  action: string;
}
export interface OperationalHealth {
  observedAt: number;
  serviceAvailable: boolean;
  taskReadiness: 'blocked' | 'unknown';
  components: HealthComponent[];
}
