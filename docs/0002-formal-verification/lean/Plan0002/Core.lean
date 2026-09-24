import Std

namespace Plan0002

abbrev Text := List UInt16

structure Token where
  epoch : Nat
  serial : Nat
  deriving DecidableEq, Repr

def put [DecidableEq κ] (mapping : κ → ν) (key : κ) (value : ν) : κ → ν :=
  fun queried => if queried = key then value else mapping queried

@[simp] theorem put_same [DecidableEq κ] (mapping : κ → ν) (key : κ) (value : ν) :
    put mapping key value key = value := by simp [put]

@[simp] theorem put_other [DecidableEq κ] (mapping : κ → ν) (key queried : κ)
    (value : ν) (different : queried ≠ key) :
    put mapping key value queried = mapping queried := by simp [put, different]

inductive Reachable (step : σ → ε → σ) (initial : σ) : σ → Prop where
  | start : Reachable step initial initial
  | next : Reachable step initial s → Reachable step initial (step s event)

theorem reachable_invariant (step : σ → ε → σ) (initial : σ) (invariant : σ → Prop)
    (start : invariant initial)
    (preserved : ∀ s event, invariant s → invariant (step s event))
    (trace : Reachable step initial s) : invariant s := by
  induction trace with
  | start => exact start
  | next _ ih => exact preserved _ _ ih

end Plan0002
