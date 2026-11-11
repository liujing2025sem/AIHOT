import React from 'react';
import { createRoot } from 'react-dom/client';
import BatchPreview from '../app/features/admin/batch-preview';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><BatchPreview /></React.StrictMode>);
