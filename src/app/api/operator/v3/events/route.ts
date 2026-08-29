import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {resolveOperatorV3RequestContext} from '../_shared/request-context';
import type {NextRequest} from 'next/server';
export async function GET(request:NextRequest){const resolved=await resolveOperatorV3RequestContext(request);if(resolved.response)return resolved.response;const after=request.nextUrl.searchParams.get('after');const events=await db.outboxEvent.findMany({where:{tenantId:resolved.context.tenantId,...(after?{createdAt:{gt:new Date(after)}}:{})},orderBy:{createdAt:'asc'},take:100,select:{id:true,type:true,aggregateId:true,aggregateType:true,occurredAt:true,createdAt:true}});return NextResponse.json({events:events.map(e=>({...e,occurredAt:e.occurredAt.toISOString(),createdAt:e.createdAt.toISOString()})),serverTime:new Date().toISOString()});}
