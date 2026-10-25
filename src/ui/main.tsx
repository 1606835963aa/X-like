import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../design/tokens.css';
import '../../design/theme.css';
import './style.css';
document.documentElement.dataset.platform=window.shizang?.platform??'mobile';
for(const [key,value] of Object.entries(window.shizang?.preferences??{}))localStorage.setItem(key,value);
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
