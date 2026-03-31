# ENT-Project-VIT-SMART
VIT SMART is a student-level smart muscle fatigue monitoring prototype designed for athletes, fitness users, and rehabilitation users.
## Sprint Goal
Build the first working prototype plan for VIT SMART, focusing on EMG signal collection, basic muscle fatigue monitoring, and warning logic.

## Must-have Features
1. EMG signal collection  
2. Basic muscle fatigue monitoring  
3. Fatigue / overload warning feedback  

---

## To Do

### EMG Signal Collection
- [ ] **Research suitable EMG sensor and hardware connection method**  
  Confirm which EMG sensor module will be used and check compatibility with Arduino and STM32F103.

- [ ] **Design hardware connection diagram for EMG data collection**  
  Create a simple block diagram showing EMG sensor, Arduino, STM32F103, and the signal flow.

- [ ] **Build initial EMG signal input prototype**  
  Connect hardware components and test whether raw EMG signal can be received.

- [ ] **Document EMG signal acquisition process**  
  Record setup steps, photos, and current technical issues.

### Basic Muscle Fatigue Monitoring
- [ ] **Define what muscle fatigue means in this prototype**  
  Decide which simple EMG features or thresholds will represent fatigue.

- [ ] **Design basic signal processing logic**  
  Decide how raw EMG data will be translated into understandable monitoring output.

- [ ] **Create basic monitoring output format**  
  Show muscle condition as simple states such as normal, high load, or fatigue risk.

- [ ] **Test whether muscle activity changes can be observed**  
  Compare resting and movement conditions and record output changes.

### Fatigue / Overload Warning Feedback
- [ ] **Set warning conditions for overload or fatigue**  
  Define when the system should trigger a warning.

- [ ] **Design warning output method**  
  Decide whether the warning will be shown by text, LED, buzzer, or another simple method.

- [ ] **Implement first warning mechanism**  
  Build a simple response that can be triggered when threshold conditions are met.

- [ ] **Record evidence of warning function**  
  Save screenshots, photos, or short videos for checkpoint and portfolio use.

### Project Management / Documentation
- [ ] **Write PRD draft**  
  Include user stories, feature list, and initial technical architecture.

- [ ] **Complete MoSCoW prioritization**  
  Label features as Must / Should / Could / Won’t and keep Must-haves within 3.

- [ ] **Write Week 4 Dev Log entry**  
  Add roles, sprint goal, Must-haves, Kanban link, and PRD link.

- [ ] **Book Checkpoint 1 with pathfinder**  
  Confirm date and time and record it in team documents.

---

## Doing
- [ ] **Write PRD draft**  
  The PRD is currently being prepared and refined for Week 4 submission.

---

## Done
- [x] **Project direction confirmed**  
  VIT SMART focuses on EMG-based muscle fatigue monitoring rather than general fitness tracking.

- [x] **Three Must-have features agreed**  
  The team has agreed on the core scope for Sprint 1.

---

## Blocked
- [ ] **Final hardware availability confirmation**  
  Waiting to confirm all required hardware components are available for testing.

- [ ] **EMG signal stability under real testing conditions**  
  Signal quality may be affected by movement noise or sensor placement.

---

## Notes
- This board is used to track Sprint 1 tasks for the VIT SMART prototype.
- The current focus is EMG signal collection, fatigue monitoring, and overload warning logic.
- Scope is limited to a student-level working prototype.
