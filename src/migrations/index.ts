import * as migration_20260612_074828_initial from './20260612_074828_initial';

export const migrations = [
  {
    up: migration_20260612_074828_initial.up,
    down: migration_20260612_074828_initial.down,
    name: '20260612_074828_initial'
  },
];
