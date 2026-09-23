import Plan0002.Core
import Plan0002.GuardedEdit
import Plan0002.RunOwnership
import Plan0002.McpRegistry
import Plan0002.McpLifecycle
import Plan0002.VaultPaths
import Plan0002.RestoreState
import ProofAudit

#print axioms Plan0002.put_same
#print axioms Plan0002.put_other
#print axioms Plan0002.reachable_invariant
#print axioms Plan0002.GuardedEdit.ready_has_snapshot
#print axioms Plan0002.GuardedEdit.guarded_commit
#print axioms Plan0002.GuardedEdit.conflict_preserves_disk
#print axioms Plan0002.GuardedEdit.useful_success
#print axioms Plan0002.GuardedEdit.missing_is_not_empty
#print axioms Plan0002.GuardedEdit.successful_snapshot
#print axioms Plan0002.GuardedEdit.other_snapshot_unchanged
#print axioms Plan0002.GuardedEdit.failure_preserves_snapshots
#print axioms Plan0002.RunOwnership.initial_valid
#print axioms Plan0002.RunOwnership.busy_rejects
#print axioms Plan0002.RunOwnership.stale_output
#print axioms Plan0002.RunOwnership.stale_completion
#print axioms Plan0002.RunOwnership.cancellation_invalidates
#print axioms Plan0002.RunOwnership.success_starts_one_prompt
#print axioms Plan0002.RunOwnership.step_preserves
#print axioms Plan0002.RunOwnership.reachable_valid
#print axioms Plan0002.McpRegistry.initial_valid
#print axioms Plan0002.McpRegistry.collision_rejected
#print axioms Plan0002.McpRegistry.useful_registration
#print axioms Plan0002.McpRegistry.registration_preserves
#print axioms Plan0002.McpRegistry.removal_preserves
#print axioms Plan0002.McpRegistry.unique_resolution
#print axioms Plan0002.McpRegistry.dispatch_matches_registration
#print axioms Plan0002.McpRegistry.stale_dispatch_rejected
#print axioms Plan0002.McpRegistry.removed_server_cannot_dispatch
#print axioms Plan0002.McpRegistry.reserved_name_rejected
#print axioms Plan0002.McpRegistry.ordinary_name_allowed
#print axioms Plan0002.McpRegistry.step_preserves
#print axioms Plan0002.McpRegistry.reachable_valid
#print axioms Plan0002.McpLifecycle.initial_valid
#print axioms Plan0002.McpLifecycle.stale_success_disposed
#print axioms Plan0002.McpLifecycle.stale_failure_preserves_error
#print axioms Plan0002.McpLifecycle.unload_cannot_republish
#print axioms Plan0002.McpLifecycle.useful_connection
#print axioms Plan0002.McpLifecycle.used_token_cannot_restart
#print axioms Plan0002.McpLifecycle.disable_reenable_cannot_reuse_attempt
#print axioms Plan0002.McpLifecycle.failure_invalidates_attempt
#print axioms Plan0002.McpLifecycle.step_preserves
#print axioms Plan0002.McpLifecycle.reachable_valid
#print axioms Plan0002.VaultPaths.canonical_idempotent
#print axioms Plan0002.VaultPaths.accepted_is_relative
#print axioms Plan0002.VaultPaths.accepted_segments_safe
#print axioms Plan0002.VaultPaths.skill_beneath
#print axioms Plan0002.VaultPaths.empty_folder_rejected
#print axioms Plan0002.VaultPaths.empty_segment_folder_rejected
#print axioms Plan0002.VaultPaths.skill_requires_canonical_inputs
#print axioms Plan0002.VaultPaths.ordinary_note_accepted
#print axioms Plan0002.VaultPaths.empty_middle_collapses
#print axioms Plan0002.VaultPaths.sibling_prefix_rejected
#print axioms Plan0002.RestoreState.interrupted_recovery
#print axioms Plan0002.RestoreState.chat_idempotent
#print axioms Plan0002.RestoreState.selected_exists
#print axioms Plan0002.RestoreState.restore_idempotent
#print axioms Plan0002.RestoreState.unique_ids_preserved
#print axioms Plan0002.RestoreState.flags_require_true_boolean
#print axioms Plan0002.RestoreState.busy_save_unchanged
#print axioms Plan0002.RestoreState.save_reads_at_start
#print axioms Plan0002.RestoreState.failed_save_retains_last_successful_input
#print axioms Plan0002.RestoreState.failed_save_allows_next
#print axioms Plan0002.RestoreState.successful_save_records_input

audit_theorems [
  Plan0002.put_same,
  Plan0002.put_other,
  Plan0002.reachable_invariant,
  Plan0002.GuardedEdit.ready_has_snapshot,
  Plan0002.GuardedEdit.guarded_commit,
  Plan0002.GuardedEdit.conflict_preserves_disk,
  Plan0002.GuardedEdit.useful_success,
  Plan0002.GuardedEdit.missing_is_not_empty,
  Plan0002.GuardedEdit.successful_snapshot,
  Plan0002.GuardedEdit.other_snapshot_unchanged,
  Plan0002.GuardedEdit.failure_preserves_snapshots,
  Plan0002.RunOwnership.initial_valid,
  Plan0002.RunOwnership.busy_rejects,
  Plan0002.RunOwnership.stale_output,
  Plan0002.RunOwnership.stale_completion,
  Plan0002.RunOwnership.cancellation_invalidates,
  Plan0002.RunOwnership.success_starts_one_prompt,
  Plan0002.RunOwnership.step_preserves,
  Plan0002.RunOwnership.reachable_valid,
  Plan0002.McpRegistry.initial_valid,
  Plan0002.McpRegistry.collision_rejected,
  Plan0002.McpRegistry.useful_registration,
  Plan0002.McpRegistry.registration_preserves,
  Plan0002.McpRegistry.removal_preserves,
  Plan0002.McpRegistry.unique_resolution,
  Plan0002.McpRegistry.dispatch_matches_registration,
  Plan0002.McpRegistry.stale_dispatch_rejected,
  Plan0002.McpRegistry.removed_server_cannot_dispatch,
  Plan0002.McpRegistry.reserved_name_rejected,
  Plan0002.McpRegistry.ordinary_name_allowed,
  Plan0002.McpRegistry.step_preserves,
  Plan0002.McpRegistry.reachable_valid,
  Plan0002.McpLifecycle.initial_valid,
  Plan0002.McpLifecycle.stale_success_disposed,
  Plan0002.McpLifecycle.stale_failure_preserves_error,
  Plan0002.McpLifecycle.unload_cannot_republish,
  Plan0002.McpLifecycle.useful_connection,
  Plan0002.McpLifecycle.used_token_cannot_restart,
  Plan0002.McpLifecycle.disable_reenable_cannot_reuse_attempt,
  Plan0002.McpLifecycle.failure_invalidates_attempt,
  Plan0002.McpLifecycle.step_preserves,
  Plan0002.McpLifecycle.reachable_valid,
  Plan0002.VaultPaths.canonical_idempotent,
  Plan0002.VaultPaths.accepted_is_relative,
  Plan0002.VaultPaths.accepted_segments_safe,
  Plan0002.VaultPaths.skill_beneath,
  Plan0002.VaultPaths.empty_folder_rejected,
  Plan0002.VaultPaths.empty_segment_folder_rejected,
  Plan0002.VaultPaths.skill_requires_canonical_inputs,
  Plan0002.VaultPaths.ordinary_note_accepted,
  Plan0002.VaultPaths.empty_middle_collapses,
  Plan0002.VaultPaths.sibling_prefix_rejected,
  Plan0002.RestoreState.interrupted_recovery,
  Plan0002.RestoreState.chat_idempotent,
  Plan0002.RestoreState.selected_exists,
  Plan0002.RestoreState.restore_idempotent,
  Plan0002.RestoreState.unique_ids_preserved,
  Plan0002.RestoreState.flags_require_true_boolean,
  Plan0002.RestoreState.busy_save_unchanged,
  Plan0002.RestoreState.save_reads_at_start,
  Plan0002.RestoreState.failed_save_retains_last_successful_input,
  Plan0002.RestoreState.failed_save_allows_next,
  Plan0002.RestoreState.successful_save_records_input]
