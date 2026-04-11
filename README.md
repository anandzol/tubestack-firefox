<div align="center">
  <img src="assets/icons/icon128.png" alt="TubeStack Icon" />
  <h1>TubeStack</h1>
</div>

## Features

TubeStack transforms your YouTube experience by allowing you to organize your subscriptions into manageable, custom groups.

### 1. Seamless YouTube Sidebar Integration
TubeStack is beautifully integrated right into your YouTube sidebar. You can easily view and access your customized subscription groups natively without interrupting your flow.

<p align="center">
  <img src="assets/screenshots/youtube_home_guide_menu_groups_display.png" alt="YouTube Home Guide Menu Groups Display" />
</p>

### 2. Dedicated Group Feeds
Clicking on a group instantly brings up a dedicated feed containing all the latest videos specifically from the channels within that group.

<p align="center">
  <img src="assets/screenshots/Group_feed.png" alt="Group Feed" />
</p>

### 3. Customizable Settings Dashboard
Take full control over the extension's behavior through the comprehensive and intuitive settings dashboard. Customize aspects such as:
- **Sidebar Position:** Choose exactly where the TubeStack groups appear within the YouTube sidebar menu.
- **Feed Customization:** Adjust the number of videos loaded per feed to fit your viewing preferences.

<p align="center">
  <img src="assets/screenshots/dashboard_settings.png" alt="Dashboard Settings" />
</p>

### 4. Import & Export Flexibility
Easily backup your categorized groups and channels, or import your backups across different devices to sync your personalized setup.

<p align="center">
  <img src="assets/screenshots/dashboard_importexport.png" alt="Dashboard Import/Export" />
</p>

### 5. Advanced Group Management
Create, edit, and organize multiple groups directly from the dashboard to curate your viewing habits exactly how you want.

<p align="center">
  <img src="assets/screenshots/dashboard_groups.png" alt="Dashboard Groups" />
</p>

### 6. Channel Organization
Assign specific YouTube channels to your distinct groups with a few simple clicks inside the dashboard interface.

<p align="center">
  <img src="assets/screenshots/dashboard_channels.png" alt="Dashboard Channels" />
</p>

## Setup and Installation

### Option 1: Quick Install (Loading the ZIP)

1. Download the latest compiled `.zip` file from the repository releases.
2. Extract the contents of the ZIP file to a folder on your computer.
3. Open your browser and navigate to the extensions page (e.g., `chrome://extensions/` for Chrome/Brave).
4. Enable **Developer mode** (usually found in the top right corner).
5. Click **Load unpacked** and select the extracted folder.
6. TubeStack is now installed and ready to be set up!

### Option 2: Clean Install from Source 

If you wish to build the extension yourself from its source files, ensure you have [Node.js](https://nodejs.org/) and `npm` installed.

1. Clone or download this project's source code to your local machine.
2. Open a terminal and navigate to the root directory of the project:
   ```bash
   cd TubeStack
   ```
3. Install the necessary build dependencies using npm:
   ```bash
   npm install
   ```
4. Build the application for production:
   ```bash
   npm run build
   ```
   *This command will generate a compiled `dist` directory.*
5. Open your browser and navigate to the extensions page (e.g., `chrome://extensions/`).
6. Enable **Developer mode**.
7. Click **Load unpacked** and select the newly created `dist` folder located inside the project directory.
