-- Pre-rollout only: never discard unsaved recovery data after activation. No CASCADE.
DROP TABLE IF EXISTS together_offline_commands, together_offline_executions, together_offline_devices;
