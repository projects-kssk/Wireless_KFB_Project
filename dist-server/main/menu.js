// main/menu.ts
import { app, Menu } from 'electron';
const isMac = process.platform === 'darwin';
const template = [
    {
        label: app.name,
        submenu: [
            isMac
                ? { role: 'quit', label: 'Close' }
                : { role: 'close', label: 'Close' }
        ]
    }
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));
