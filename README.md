# VIT SMART

> **Evidence-led Smart Exercise Feedback System**  
> A continuing student venture developed for ENT303TC Team Technopreneurship.

---

## 1. Project Overview

**VIT SMART** is a technology-enabled exercise feedback system designed to help users make clearer training decisions during exercise.

The project was originally developed as a **smart muscle fatigue monitoring system**, combining:

- Surface EMG signal acquisition
- EMG signal processing
- Camera / pose input
- Movement analysis
- Real-time feedback
- AI-assisted training guidance

The original concept aimed to convert complex physiological signals into simple and actionable feedback for exercise users.

During the previous development cycle, the team implemented a preliminary system architecture and explored a simplified three-state feedback model:

- **Normal**
- **High Load**
- **Fatigue Risk**

However, further review identified important limitations in the physiological validation and signal stability of the EMG-based fatigue classification approach.

For the current ENT303TC development cycle, the project is therefore being **re-validated rather than treated as a finished solution**.

---

## 2. Current Project Status

### Previous Direction

The previous prototype focused primarily on:

> **EMG-based muscle fatigue monitoring and real-time training feedback**

The system concept included the following data flow:

```text
EMG Sensors
        \
         → Signal Processing → Fatigue / Movement Assessment
        /
Camera / Pose Input

        ↓

User Feedback / Dashboard

        ↓

AI-supported Training Guidance
