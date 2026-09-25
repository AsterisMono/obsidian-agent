import PlanSteadyFalconFormalVerification.Core

namespace PlanSteadyFalconFormalVerification.VaultPaths

abbrev Segments := List Text

def canonical (parts : Segments) : Segments := parts.filter (· != [])

def safeSegment (part : Text) : Bool := part.head? != some 46

def absolute (path : Text) : Bool := path.head? == some 47

def drivePrefix (path : Text) : Bool :=
  match path with
  | letter :: 58 :: _ =>
    decide ((65 ≤ letter.toNat ∧ letter.toNat ≤ 90) ∨
      (97 ≤ letter.toNat ∧ letter.toNat ≤ 122))
  | _ => false

def markdown (path : Text) : Bool :=
  match path.reverse with
  | d :: m :: 46 :: _ => (d == 100 || d == 68) && (m == 109 || m == 77)
  | _ => false

def allowed (raw : Text) : Bool :=
  !absolute raw && !drivePrefix raw && !(raw.contains 92) &&
    (raw.splitOn 47).all safeSegment && markdown raw

def accept (raw normalized : Text) : Option Segments :=
  let parts := canonical (raw.splitOn 47)
  if allowed raw && normalized == [47].intercalate parts then some parts else none

def canonicalSegments (parts : Segments) : Bool :=
  parts.all (fun part => !part.isEmpty && !(part.contains 47))

def skillMembership (folder file : Segments) : Bool :=
  !folder.isEmpty && folder.isPrefixOf file && decide (folder.length < file.length) &&
    file.getLast? == some [83, 75, 73, 76, 76, 46, 109, 100] && file.all safeSegment

def skill (folder file : Segments) : Bool :=
  canonicalSegments folder && canonicalSegments file && skillMembership folder file

theorem canonical_idempotent (parts : Segments) :
    canonical (canonical parts) = canonical parts := by
  simp [canonical, List.filter_filter]

theorem accepted_is_relative
    (accepted : accept raw normalized = some parts) :
    absolute raw = false ∧ drivePrefix raw = false ∧ raw.contains 92 = false ∧ markdown raw = true := by
  simp only [accept] at accepted
  split at accepted
  · rename_i guards
    simp [allowed] at guards
    grind
  · contradiction

theorem accepted_segments_safe
    (accepted : accept raw normalized = some parts) (member : part ∈ parts) :
    part ≠ [] ∧ safeSegment part = true := by
  simp only [accept] at accepted
  split at accepted
  · rename_i guards
    cases accepted
    have member' := List.mem_filter.mp member
    simp [allowed] at guards
    constructor
    · simpa using member'.2
    · exact guards.1.1.2 part member'.1
  · contradiction

theorem skill_beneath (found : skill folder file = true) :
    folder ≠ [] ∧ folder.IsPrefix file ∧ folder.length < file.length := by
  simp only [skill, Bool.and_eq_true] at found
  have membership := found.2
  simp [skillMembership] at membership
  exact ⟨membership.1.1.1.1, membership.1.1.1.2, membership.1.1.2⟩

theorem empty_folder_rejected (file : Segments) : skill [] file = false := by
  simp [skill, skillMembership]

theorem empty_segment_folder_rejected (file : Segments) : skill [[]] file = false := by
  simp [skill, canonicalSegments]

theorem skill_requires_canonical_inputs (found : skill folder file = true) :
    canonicalSegments folder = true ∧ canonicalSegments file = true := by
  simp [skill] at found
  exact found.1

theorem ordinary_note_accepted :
    accept [78, 111, 116, 101, 46, 109, 100] [78, 111, 116, 101, 46, 109, 100] =
      some [[78, 111, 116, 101, 46, 109, 100]] := by decide

theorem empty_middle_collapses : canonical [[65], [], [66, 46, 77, 68]] = [[65], [66, 46, 77, 68]] := by
  decide

theorem sibling_prefix_rejected :
    skill [[83, 107, 105, 108, 108, 115]]
      [[83, 107, 105, 108, 108, 115, 45, 101, 120, 116, 114, 97],
       [83, 75, 73, 76, 76, 46, 109, 100]] = false := by decide

end PlanSteadyFalconFormalVerification.VaultPaths
