import PlanSteadyFalconFormalVerification.Core

namespace PlanSteadyFalconFormalVerification.RestoreState

inductive JsonValue where
  | null
  | bool (value : Bool)
  | text (value : Text)
  | number (lexeme : String)
  | array (values : List JsonValue)
  | object (entries : List (String × JsonValue))
  deriving Repr, BEq

def trueFlag (value : JsonValue) (key : String) : Bool :=
  match value with
  | .object fields =>
    match fields.lookup key with
    | some (.bool true) => true
    | _ => false
  | _ => false

structure Chat where
  id : String
  pending : Bool := false
  interrupted : Bool := false
  messages : List JsonValue := []
  deriving Repr

def restoreChat (chat : Chat) : Chat :=
  { chat with pending := false, interrupted := chat.pending || chat.interrupted }

structure State where
  chats : List Chat
  selected : String
  deriving Repr

def restore (s : State) (fresh : String) : State :=
  let chats := s.chats.map restoreChat
  if chats.any (fun chat => chat.id == s.selected) then
    { chats := chats, selected := s.selected }
  else { chats := chats ++ [⟨fresh, false, false, []⟩], selected := fresh }

theorem interrupted_recovery (chat : Chat) (pending : chat.pending = true) :
    (restoreChat chat).pending = false ∧ (restoreChat chat).interrupted = true ∧
      (restoreChat chat).messages = chat.messages := by simp [restoreChat, pending]

theorem chat_idempotent (chat : Chat) : restoreChat (restoreChat chat) = restoreChat chat := by
  simp [restoreChat]

theorem selected_exists (s : State) (fresh : String) :
    ∃ chat ∈ (restore s fresh).chats, chat.id = (restore s fresh).selected := by
  simp only [restore]
  split
  · rename_i selected
    simpa using List.any_eq_true.mp selected
  · exact ⟨⟨fresh, false, false, []⟩, by simp, rfl⟩

theorem restore_idempotent (s : State) (fresh nextFresh : String) :
    restore (restore s fresh) nextFresh = restore s fresh := by
  have stable : (restore s fresh).chats.map restoreChat = (restore s fresh).chats := by
    simp only [restore]
    split <;> simp [List.map_map, Function.comp_def, restoreChat]
  have present : ((restore s fresh).chats.any (fun chat => chat.id == (restore s fresh).selected)) = true := by
    simpa only [List.any_eq_true, beq_iff_eq] using selected_exists s fresh
  generalize restore s fresh = restored at *
  simp [restore, stable, present]

theorem unique_ids_preserved (unique : (s.chats.map Chat.id).Nodup)
    (unused : fresh ∉ s.chats.map Chat.id) :
    ((restore s fresh).chats.map Chat.id).Nodup := by
  simp only [restore]
  split <;> simp_all [List.map_map, Function.comp_def, restoreChat, List.nodup_append]

theorem flags_require_true_boolean :
    trueFlag (.object [("pending", .bool true)]) "pending" = true ∧
    trueFlag (.object [("pending", .text [116, 114, 117, 101])]) "pending" = false ∧
    trueFlag .null "pending" = false := by decide

structure SaveQueue (α : Type) where
  current : α
  queued : Nat := 0
  inFlight : Option α := none
  lastSuccessfulInput : Option α := none

def enqueue (s : SaveQueue α) : SaveQueue α := { s with queued := s.queued + 1 }

def startSave (s : SaveQueue α) : SaveQueue α :=
  match s.inFlight, s.queued with
  | none, n + 1 => { s with queued := n, inFlight := some s.current }
  | _, _ => s

def finishSave (s : SaveQueue α) (success : Bool) : SaveQueue α :=
  match s.inFlight with
  | none => s
  | some value => { s with inFlight := none, lastSuccessfulInput := if success then some value else s.lastSuccessfulInput }

theorem busy_save_unchanged (busy : s.inFlight = some value) : startSave s = s := by
  simp [startSave, busy]

theorem save_reads_at_start (idle : s.inFlight = none) :
    (startSave (enqueue s)).inFlight = some s.current := by simp [startSave, enqueue, idle]

theorem failed_save_retains_last_successful_input (s : SaveQueue α) :
    (finishSave s false).lastSuccessfulInput = s.lastSuccessfulInput := by
  cases h : s.inFlight <;> simp [finishSave, h]

theorem failed_save_allows_next (busy : s.inFlight = some value) :
    (startSave (enqueue (finishSave s false))).inFlight = some s.current := by
  simp [finishSave, busy, enqueue, startSave]

theorem successful_save_records_input (busy : s.inFlight = some value) :
    (finishSave s true).lastSuccessfulInput = some value := by simp [finishSave, busy]

end PlanSteadyFalconFormalVerification.RestoreState
