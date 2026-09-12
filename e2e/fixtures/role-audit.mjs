import { PrismaClient } from '../../src/generated/postgres-client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
export async function createRoleAuditFixture(){
 const connectionString=process.env.DATABASE_URL_POSTGRES; const u=new URL(connectionString);
 if(!['localhost','127.0.0.1'].includes(u.hostname)||!/^\/pilingtrack_(test|ci)$/.test(u.pathname))throw new Error('Role audit fixtures require a local pilingtrack_test or pilingtrack_ci database');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString})});
 const prefix='role-audit-'+Date.now(); const password=randomBytes(18).toString('hex');
 try {const tenant=await db.tenant.create({data:{slug:prefix,name:'QA browser '+prefix,maxUsers:20,subscriptionStatus:'active'}});
 await db.tenantSettings.create({data:{tenantId:tenant.id,companyName:'QA browser',notifications:{criticalDefect:false}}});
 const users={}; for(const role of ['ADMIN','DISPATCHER','OPERATOR','ASSISTANT','MECHANIC','FOREMAN','SAFETY_ENGINEER']){
 users[role]=await db.user.create({data:{tenantId:tenant.id,email:role.toLowerCase()+'@'+prefix+'.test',name:'QA '+role,role,password:await bcrypt.hash(password,10)}});
 }
 const equipment=await db.equipment.create({data:{tenantId:tenant.id,name:'QA КБУРГ',model:'КБУРГ',kind:'PILE_DRIVER',hammerKind:'HYDRAULIC',engineHoursTotal:100,fuelTankLiters:400}});
 const site=await db.site.create({data:{tenantId:tenant.id,name:'QA полигон',plannedPiles:100}});
 const crew=await db.crew.create({data:{name:'QA бригада',operatorId:users.OPERATOR.id,equipmentId:equipment.id,siteId:site.id,assistants:{create:{userId:users.ASSISTANT.id,name:users.ASSISTANT.name}}}});
 await db.userSiteAssignment.createMany({data:Object.values(users).map(u=>({userId:u.id,siteId:site.id}))});
 const pile=await db.pileGrade.create({data:{tenantId:tenant.id,name:'QA C120.30',normalizedName:'qa c120.30',lengthMm:12000}});
 await db.drillingType.create({data:{tenantId:tenant.id,name:'QA бурение',normalizedName:'qa бурение'}});
 await db.downtimeReason.create({data:{tenantId:tenant.id,name:'QA ожидание',normalizedName:'qa ожидание'}});
 return {tenantId:tenant.id,password,users:Object.fromEntries(Object.entries(users).map(([k,v])=>[k,{id:v.id,email:v.email}])),equipmentId:equipment.id,siteId:site.id,crewId:crew.id,pileId:pile.id};
 } finally {await db.$disconnect()}
}
