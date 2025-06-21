# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.


Limitations:
1. once monitoring a group , we cannot go back
2. real time messages are not automatically displayed, we have to press fetch history
3. diplay the image/ video in the frontend to do that use .json file
4. trying to fetch chats immediately after login, not waiting for whatsapp client to get ready.
5. messages.json stores only the history messages not the new ones coming.

include .json file so that we can push the images back to backend database and also images to display it on frontend.

understand if the process by which we are displaying content on the frontend , is it through json or through rss feed

future scope: make it multi-tenant so that multiple user can login 



