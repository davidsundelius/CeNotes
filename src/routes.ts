import { createRouter, createWebHistory } from 'vue-router';
import Player from './components/Player.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: Player
  },
  {
    path: '/song/:songName',
    name: 'song',
    component: Player,
    props: true
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

export default router;
