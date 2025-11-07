# Horse Racing Webapp Project Overview

## 1. Project Description

This project is a single-page web application that simulates a horse race. The host can enter player names, and these players are represented as horses in a race that progresses randomly. A key feature is that spectators can join an active race and "cheer" for specific horses, giving them a speed advantage in real-time.

## 2. Core Features

*   **Race Host:**
    *   Can enter between 2 and 10 player names.
    *   Starts the race and watches the animation.
*   **Spectator Mode:**
    *   Can join an ongoing race.
    *   Can cheer for horses to boost their speed.
*   **Real-time Synchronization:**
    *   Uses Firebase Realtime Database to sync cheer counts.
    *   Cheering immediately affects the race outcome.
*   **Session Management:**
    *   A new session is created in Firebase when a race starts.
    *   The session data is automatically cleaned up from the database when the race ends or the host navigates away.

## 3. Technology Stack

*   **Frontend:** HTML5, CSS3, JavaScript (ES2023 Modules)
    *   It is a simple, static web project with no build process.
*   **Database:** Firebase Realtime Database
*   **Testing:**
    *   Unit Tests: Vitest
    *   End-to-End (E2E) Tests: Playwright
*   **Deployment:**
    *   The application consists of three static files: `index.html`, `style.css`, and `app.js`.
