import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ConsoleApp from './ConsoleApp';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ConsoleApp /></StrictMode>);
