window.FPL_DEMO = {
  manager: {
    id: 2320843,
    player_first_name: 'Demo',
    player_last_name: 'Manager',
    name: 'Team 2320843',
    summary_overall_points: 173,
    summary_overall_rank: 3811905,
    last_deadline_value: 1000,
    last_deadline_bank: 0,
  },
  event: { id: 4, name: 'Gameweek 4', deadline_time: '2026-09-12T12:30:00Z', is_next: true },
  teams: [
    [1,'ARS','Arsenal'],[2,'BHA','Brighton'],[3,'CHE','Chelsea'],[4,'HUL','Hull'],[5,'IPS','Ipswich'],[6,'LEE','Leeds'],[7,'MCI','Man City'],[8,'MUN','Man Utd'],[9,'NFO','Nottm Forest'],[10,'TOT','Spurs'],[11,'NEW','Newcastle']
  ].map(([id,short_name,name])=>({id,short_name,name})),
  players: [
    ['Kinsky',10,1,45,'EVE (H)',95,6.5],['Dúbravka',10,1,40,'EVE (H)',10,3],
    ['Gabriel',1,2,80,'SUN (A)',98,9.5],['Konsa',1,2,44,'SUN (A)',92,8],['Maguire',8,2,50,'MCI (H)',82,6],['Davis',5,2,40,'CRY (A)',90,6],['Diop',5,2,40,'CRY (A)',90,5.5],
    ['B. Fernandes',8,3,120,'MCI (H)',96,8.5],['Mbeumo',8,3,80,'MCI (H)',95,9],['Groß',2,3,55,'COV (A)',95,8.5],['Stach',6,3,60,'NEW (H)',90,7],['Slater',4,3,45,'CHE (A)',90,5.5],
    ['Haaland',7,4,155,'MUN (A)',98,10],['João Pedro',3,4,77,'HUL (H)',98,9.5],['Wissa',11,4,62,'LEE (A)',94,8.5]
  ].map((p,i)=>({id:1001+i,web_name:p[0],team:p[1],element_type:p[2],now_cost:p[3],demo_fixture:p[4],demo_start:p[5],demo_hold:p[6],selected_by_percent:String((5+i*1.7).toFixed(1)),expected_goal_involvements:(i%5/3).toFixed(2),total_points:10+i,form:(2+i%7).toFixed(1),status:'a',chance_of_playing_next_round:null,minutes:i===14?211:270,starts:i===14?2:3})),
  picks: {
    active_chip:null,
    entry_history:{event:3,points:52,total_points:173,rank:4505343,bank:0,value:1000},
    picks:[
      [1001,1,1,false,false],[1004,2,1,false,false],[1003,3,1,false,false],[1007,4,1,false,false],
      [1008,5,1,false,false],[1009,6,1,false,false],[1010,7,1,false,false],[1011,8,1,false,false],
      [1015,9,1,false,false],[1013,10,1,false,true],[1014,11,2,true,false],
      [1002,12,0,false,false],[1006,13,0,false,false],[1012,14,0,false,false],[1005,15,0,false,false]
    ].map(([element,position,multiplier,is_captain,is_vice_captain])=>({element,position,multiplier,is_captain,is_vice_captain}))
  },
  plannedSuggestions: [
    { out:'Mosquera', in:'Konsa' },
    { out:'Igor Jesus', in:'Wissa' }
  ]
};
