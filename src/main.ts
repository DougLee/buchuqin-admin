import {createApp} from 'vue';import {createRouter,createWebHashHistory}from'vue-router';import App from'./App.vue';import Dashboard from'./pages/Dashboard.vue';import DataPage from'./pages/DataPage.vue';import'./style.css';import'./drawer.css';
const routes=[{path:'/',component:Dashboard},{path:'/:section',component:DataPage}];
createApp(App).use(createRouter({history:createWebHashHistory(),routes})).mount('#app');
