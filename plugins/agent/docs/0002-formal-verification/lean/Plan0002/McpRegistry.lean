import Plan0002.Core

namespace Plan0002.McpRegistry

structure Target where
  server : String
  tool : String
  generation : Token
  deriving DecidableEq, Repr

abbrev Registry := Text → Option Target

def empty : Registry := fun _ => none

def asciiNameUnit (unit : UInt16) : Bool :=
  decide ((65 ≤ unit.toNat ∧ unit.toNat ≤ 90) ∨
    (97 ≤ unit.toNat ∧ unit.toNat ≤ 122) ∨
    (48 ≤ unit.toNat ∧ unit.toNat ≤ 57) ∨ unit = 95 ∨ unit = 45)

def nameAllowed (limit : Nat) (reserved : List Text) (name : Text) : Bool :=
  !name.isEmpty && decide (name.length ≤ limit) && name.all asciiNameUnit && !(reserved.contains name)

def register (registry : Registry) (name : Text) (target : Target)
    (permitted : Text → Bool) : Bool × Registry :=
  if permitted name && (registry name).isNone then
    (true, put registry name (some target))
  else (false, registry)

def dispatch (registry : Registry) (current : String → Option Token) (name : Text)
    (held : Target) : Option Target :=
  if registry name = some held ∧ current held.server = some held.generation then some held else none

def removeServer (registry : Registry) (server : String) : Registry :=
  fun name => match registry name with
    | some target => if target.server = server then none else some target
    | none => none

def Invariant (permitted : Text → Bool) (registry : Registry) : Prop :=
  ∀ name target, registry name = some target → permitted name = true

theorem initial_valid : Invariant permitted empty := by simp [Invariant, empty]

theorem collision_rejected (occupied : registry name = some previous) :
    register registry name target permitted = (false, registry) := by
  simp [register, occupied]

theorem useful_registration (valid : permitted name = true) (free : registry name = none) :
    (register registry name target permitted).1 = true ∧
    (register registry name target permitted).2 name = some target := by
  simp [register, valid, free]

theorem registration_preserves (valid : Invariant permitted registry) :
    Invariant permitted (register registry name target permitted).2 := by
  unfold register
  split
  · rename_i allowed
    intro queried value present
    by_cases same : queried = name
    · subst queried
      simp only [Bool.and_eq_true] at allowed
      exact allowed.1
    · apply valid queried value
      simpa [put, same] using present
  · exact valid

theorem removal_preserves (valid : Invariant permitted registry) :
    Invariant permitted (removeServer registry server) := by
  intro name target entry
  unfold removeServer at entry
  split at entry
  · split at entry
    · contradiction
    · cases entry
      exact valid _ _ (by assumption)
  · contradiction

theorem unique_resolution (registry : Registry)
    (first : registry name = some a) (second : registry name = some b) :
    a = b := by grind

theorem dispatch_matches_registration
    (result : dispatch registry current name held = some target) :
    target = held ∧ registry name = some target ∧
      current target.server = some target.generation := by
  grind [dispatch]

theorem stale_dispatch_rejected (stale : current held.server ≠ some held.generation) :
    dispatch registry current name held = none := by
  simp [dispatch, stale]

theorem removed_server_cannot_dispatch :
    dispatch (removeServer registry held.server) current name held = none := by
  unfold dispatch removeServer
  split <;> split <;> simp_all <;> grind

theorem reserved_name_rejected (reservedName : name ∈ reserved) :
    register registry name target (nameAllowed limit reserved) = (false, registry) := by
  simp [register, nameAllowed, reservedName]

theorem ordinary_name_allowed : nameAllowed 64 [] [109, 99, 112, 95, 97, 95, 112] = true := by
  decide

inductive Event where
  | add (name : Text) (target : Target)
  | remove (server : String)

def step (permitted : Text → Bool) (registry : Registry) : Event → Registry
  | .add name target => (register registry name target permitted).2
  | .remove server => removeServer registry server

theorem step_preserves (valid : Invariant permitted registry) (event : Event) :
    Invariant permitted (step permitted registry event) := by
  cases event with
  | add => exact registration_preserves valid
  | remove => exact removal_preserves valid

theorem reachable_valid (trace : Reachable (step permitted) empty registry) :
    Invariant permitted registry :=
  reachable_invariant (step permitted) empty (Invariant permitted) initial_valid
    (fun _ event h => step_preserves h event) trace

end Plan0002.McpRegistry
